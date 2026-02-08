"""Deep Research tool for nanobot — calls AI server's Deep Research SSE endpoint."""

import json
from typing import Any

import httpx
from loguru import logger

from nanobot.agent.tools.base import Tool


class LitewriteDeepResearchTool(Tool):
    """
    Tool to perform deep research via Litewrite's AI server.

    Sends a query to the Deep Research SSE endpoint, consumes the event stream,
    and returns the aggregated report with references and BibTeX.
    """

    def __init__(self, ai_server_url: str):
        self._ai_server_url = ai_server_url.rstrip("/")

    @property
    def name(self) -> str:
        return "litewrite_deep_research"

    @property
    def description(self) -> str:
        return (
            "Perform deep research on a topic. "
            "Searches arXiv papers and the web, analyzes knowledge gaps with "
            "multi-iteration search, then generates a comprehensive research report "
            "with references and BibTeX. "
            "This tool may take a few minutes to complete. "
            "The result includes the full report in Markdown, a references list, "
            "and BibTeX entries for academic citations."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The research question or topic to investigate",
                },
                "max_iterations": {
                    "type": "integer",
                    "description": (
                        "Maximum number of search iterations for knowledge gap "
                        "analysis (default: 3, range: 1-5)"
                    ),
                    "minimum": 1,
                    "maximum": 5,
                },
                "structured": {
                    "type": "boolean",
                    "description": (
                        "Whether to use structured mode with outline planning "
                        "and section-by-section generation (default: true)"
                    ),
                },
            },
            "required": ["query"],
        }

    async def execute(
        self,
        query: str,
        max_iterations: int = 3,
        structured: bool = True,
        **kwargs: Any,
    ) -> str:
        """Execute deep research by consuming the AI server's SSE stream."""
        url = f"{self._ai_server_url}/api/deep-research/stream"

        payload = {
            "query": query,
            "arxiv_papers": 10,
            "web_pages": 10,
            "structured": structured,
            "max_iterations": max_iterations,
        }

        logger.info(
            f"Starting deep research: query={query!r}, "
            f"max_iterations={max_iterations}, structured={structured}"
        )

        report_chunks: list[str] = []
        # Shared mutable state dict — created ONCE, passed by reference to _process_event
        result_state: dict[str, Any] = {
            "bibtex": "",
            "references_markdown": "",
            "arxiv_count": 0,
            "web_count": 0,
            "error_message": "",
        }

        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as client:
                async with client.stream(
                    "POST",
                    url,
                    json=payload,
                    headers={"Content-Type": "application/json"},
                ) as response:
                    if response.status_code != 200:
                        body = await response.aread()
                        return (
                            f"Deep research request failed (HTTP {response.status_code}): "
                            f"{body.decode(errors='replace')}"
                        )

                    # Parse SSE stream
                    event_type = ""

                    async for line in response.aiter_lines():
                        # SSE format: "event: <type>\ndata: <json>\n\n"
                        if line.startswith("event: "):
                            event_type = line[7:].strip()
                            continue

                        if line.startswith("data: "):
                            data_buffer = line[6:]
                            self._process_event(
                                event_type,
                                data_buffer,
                                report_chunks,
                                result_state,
                            )
                            continue

                        if line == "":
                            event_type = ""

        except httpx.TimeoutException:
            return "Error: Deep research timed out after 300 seconds."
        except httpx.ConnectError as e:
            return (
                f"Error: Could not connect to AI server at {self._ai_server_url}: {e}"
            )
        except Exception as e:
            logger.error(f"Deep research error: {e}")
            return f"Error during deep research: {e}"

        if result_state["error_message"]:
            return f"Deep research failed: {result_state['error_message']}"

        report_content = "".join(report_chunks)

        if not report_content.strip():
            return "Deep research completed but produced no report content."

        # Build final output
        parts = [report_content.strip()]

        if result_state["references_markdown"]:
            parts.append(
                f"\n\n---\n\n## References\n\n{result_state['references_markdown']}"
            )

        if result_state["bibtex"]:
            parts.append(
                f"\n\n---\n\n## BibTeX\n\n```bibtex\n{result_state['bibtex']}\n```"
            )

        arxiv_count = result_state["arxiv_count"]
        web_count = result_state["web_count"]
        summary = (
            f"\n\n---\nResearch complete: {arxiv_count} arXiv papers, "
            f"{web_count} web sources."
        )
        parts.append(summary)

        result = "\n".join(parts)
        logger.info(
            f"Deep research done: {len(result)} chars, "
            f"{arxiv_count} papers, {web_count} web sources"
        )
        return result

    def _process_event(
        self,
        event_type: str,
        data_str: str,
        report_chunks: list[str],
        result_state: dict[str, Any],
    ) -> None:
        """Process a single SSE event and update state accordingly."""
        try:
            data = json.loads(data_str)
        except json.JSONDecodeError:
            return

        event_data = data.get("data", {})

        if event_type in ("report_chunk", "section_chunk"):
            chunk = event_data.get("chunk", "")
            if chunk:
                report_chunks.append(chunk)

        elif event_type == "done":
            result_state["bibtex"] = event_data.get("bibtex", "")
            result_state["references_markdown"] = event_data.get(
                "references_markdown", ""
            )
            result_state["arxiv_count"] = event_data.get("arxiv_count", 0)
            result_state["web_count"] = event_data.get("web_count", 0)

        elif event_type == "error":
            result_state["error_message"] = data.get("message", "Unknown error")

        elif event_type == "search_result":
            logger.debug(
                f"Search results: {event_data.get('arxiv_count', 0)} papers, "
                f"{event_data.get('web_count', 0)} web pages "
                f"(iteration {event_data.get('iteration', '?')})"
            )

        elif event_type == "progress":
            logger.debug(f"Research progress: {data.get('message', '')}")
