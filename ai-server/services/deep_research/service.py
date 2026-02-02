"""
DeepResearch Service
====================

Features:
- Multi-iteration search (knowledge gap analysis)
- Outline planning
- Structured streaming report generation
- Reference management
- BibTeX export

Event types:
- PROGRESS: progress update
- SEARCH_START: search started
- SEARCH_RESULT: search results
- ANALYSIS: knowledge gap analysis
- ITERATION: iteration marker
- OUTLINE_START: outline generation started
- OUTLINE_DONE: outline ready
- SECTION_START: section generation started
- SECTION_CHUNK: section chunk
- SECTION_DONE: section done
- REPORT_START: report generation started
- REPORT_CHUNK: report chunk
- REPORT_DONE: report done
- DONE: finished
- ERROR: error
"""

import asyncio
import json
import logging
from typing import Dict, Any, List, Optional, AsyncGenerator
from dataclasses import dataclass
from enum import Enum

from core import get_llm_client, LLM_MODEL, api_retry

from tools.arxiv_rag import arxiv_search
from tools.web_search import web_search

logger = logging.getLogger(__name__)

from services.deep_research.models import (
    ReferenceType,
    ReportSection,
    ReportOutline,
    ResearchReport,
)
from services.deep_research.references import ReferenceManager


# ============================================================================
# Event model
# ============================================================================


class EventType(str, Enum):
    """Event type."""

    PROGRESS = "progress"
    SEARCH_START = "search_start"
    SEARCH_RESULT = "search_result"
    ANALYSIS = "analysis"
    ITERATION = "iteration"
    OUTLINE_START = "outline_start"
    OUTLINE_DONE = "outline_done"
    SECTION_START = "section_start"
    SECTION_CHUNK = "section_chunk"
    SECTION_DONE = "section_done"
    REPORT_START = "report_start"
    REPORT_CHUNK = "report_chunk"
    REPORT_DONE = "report_done"
    DONE = "done"
    ERROR = "error"


@dataclass
class ResearchEvent:
    """Research event."""

    type: EventType
    message: str
    data: Optional[Dict[str, Any]] = None

    def to_dict(self) -> dict:
        return {
            "type": self.type.value,
            "message": self.message,
            "data": self.data or {},
        }

    def to_sse(self) -> str:
        """Convert to SSE payload."""
        return f"event: {self.type.value}\ndata: {json.dumps(self.to_dict(), ensure_ascii=False)}\n\n"


# ============================================================================
# DeepResearch service
# ============================================================================


class DeepResearchService:
    """
    Deep research service (full).

    Features:
    - Multi-iteration search (knowledge gap analysis)
    - Outline planning
    - Structured streaming generation
    - Reference management
    - BibTeX export

    Usage:
        service = DeepResearchService()

        # Simple mode
        async for event in service.research_stream("query"):
            print(event.message)

        # Structured mode (outline + section streaming)
        async for event in service.research_stream("query", structured=True):
            if event.type == EventType.OUTLINE_DONE:
                print("Outline:", event.data["outline"])
    """

    def __init__(
        self,
        max_iterations: int = 2,
        verbose: bool = False,
        project_id: Optional[str] = None,
    ):
        self.max_iterations = max_iterations
        self.verbose = verbose
        self.llm_client = get_llm_client()
        self.ref_manager = ReferenceManager()
        self.project_id = project_id

    def _log(self, message: str):
        if self.verbose:
            print(f"[DeepResearch] {message}")

    def _extract_usage(self, response) -> tuple:
        """Extract token usage and actual API cost from OpenRouter response

        Returns:
            (input_tokens, output_tokens, api_cost) tuple
        """
        input_tokens = 0
        output_tokens = 0
        api_cost = 0.0
        if hasattr(response, "usage") and response.usage:
            input_tokens = getattr(response.usage, "prompt_tokens", 0) or 0
            output_tokens = getattr(response.usage, "completion_tokens", 0) or 0
            api_cost = getattr(response.usage, "cost", 0) or 0
        return input_tokens, output_tokens, api_cost

    # ==================== Search stage ====================

    async def _search_all(
        self,
        query: str,
        arxiv_papers: int = 5,
        web_pages: int = 8,
    ) -> Dict[str, Any]:
        """Search all sources in parallel."""
        arxiv_task = arxiv_search(query, max_papers=arxiv_papers, verbose=self.verbose)
        web_task = web_search(query, max_results=web_pages, verbose=self.verbose)

        arxiv_result, web_result = await asyncio.gather(arxiv_task, web_task)

        return {"arxiv": arxiv_result, "web": web_result}

    # ==================== Iteration: knowledge gap analysis ====================

    @api_retry
    async def _analyze_knowledge_gaps(
        self,
        query: str,
        current_context: str,
    ) -> Optional[List[str]]:
        """
        Analyze the current search results, identify knowledge gaps, and propose follow-up queries.

        Returns:
            A list of follow-up queries, or None if no additional searches are needed.
        """
        prompt = """You are a research analyst. Given a research question and the current search results,
identify if there are important knowledge gaps that need additional searches.

Rules:
1. If the current results are comprehensive enough, respond with: {"need_more": false}
2. If there are gaps, provide 1-2 specific follow-up search queries
3. Focus on missing technical details, related methods, or important context
4. Do NOT repeat the original query
5. Keep follow-up queries concise and specific

Output JSON format:
{"need_more": true/false, "follow_up_queries": ["query1", "query2"]}"""

        user_message = f"""Research Question: {query}

Current Search Results Summary:
{current_context[:3000]}

Analyze if we need additional searches to fill knowledge gaps."""

        try:
            response = await self.llm_client.chat.completions.create(
                model=LLM_MODEL,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": user_message},
                ],
                response_format={"type": "json_object"},
                max_tokens=500,
            )

            result = json.loads(response.choices[0].message.content)

            if result.get("need_more") and result.get("follow_up_queries"):
                return result["follow_up_queries"][:2]

            return None

        except Exception as e:
            self._log(f"Knowledge gap analysis failed: {e}")
            return None

    # ==================== Reference processing ====================

    def _process_references(self, search_results: Dict[str, Any]) -> str:
        """Process search results, register references, and return context."""
        context_parts = []

        # Process arXiv results
        arxiv_data = search_results.get("arxiv", {})
        if arxiv_data.get("success") and arxiv_data.get("papers"):
            context_parts.append("### Academic Papers (arXiv)\n")

            for paper in arxiv_data["papers"]:
                ref_id = self.ref_manager.add_arxiv_reference(
                    arxiv_id=paper.get("arxiv_id", ""),
                    title=paper.get("title", ""),
                    authors=paper.get("authors", []),
                    year=paper.get("year", 0),
                    url=paper.get("url", ""),
                    cited_content=paper.get("abstract", "")[:500],
                    relevance_score=paper.get("relevance_score", 0),
                )

                context_parts.append(f"**[{ref_id}] {paper.get('title', '')}**")
                context_parts.append(f"arXiv: {paper.get('arxiv_id', '')}")
                authors_list = paper.get("authors", [])
                if authors_list:
                    context_parts.append(f"Authors: {', '.join(authors_list[:3])}")
                context_parts.append("")

            if arxiv_data.get("context"):
                context_parts.append(arxiv_data["context"])

        # Process web results
        web_data = search_results.get("web", {})
        if web_data.get("success") and web_data.get("results"):
            context_parts.append("\n### Web Sources\n")

            for page in web_data["results"]:
                ref_id = self.ref_manager.add_web_reference(
                    title=page.get("title", ""),
                    url=page.get("url", ""),
                    snippet=page.get("snippet", ""),
                    favicon=page.get("favicon", ""),
                    cited_content=page.get("snippet", ""),
                    relevance_score=page.get("relevance_score", 0),
                )

                context_parts.append(f"**[{ref_id}] {page.get('title', '')}**")
                context_parts.append(f"URL: {page.get('url', '')}")
                context_parts.append("")

            if web_data.get("context"):
                context_parts.append(web_data["context"])

        return "\n".join(context_parts)

    def _merge_search_results(
        self, existing: Dict[str, Any], new_results: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Merge search results (deduplicate)."""
        merged = {"arxiv": {}, "web": {}}

        # Merge arXiv
        existing_arxiv = existing.get("arxiv", {})
        new_arxiv = new_results.get("arxiv", {})

        existing_papers = existing_arxiv.get("papers", [])
        new_papers = new_arxiv.get("papers", [])

        seen_ids = {p.get("arxiv_id") for p in existing_papers}
        for paper in new_papers:
            if paper.get("arxiv_id") not in seen_ids:
                existing_papers.append(paper)
                seen_ids.add(paper.get("arxiv_id"))

        merged["arxiv"] = {
            "success": True,
            "papers": existing_papers,
            "papers_found": len(existing_papers),
            "context": existing_arxiv.get("context", "")
            + "\n"
            + new_arxiv.get("context", ""),
        }

        # Merge web
        existing_web = existing.get("web", {})
        new_web = new_results.get("web", {})

        existing_results = existing_web.get("results", [])
        new_results_list = new_web.get("results", [])

        seen_urls = {p.get("url") for p in existing_results}
        for page in new_results_list:
            if page.get("url") not in seen_urls:
                existing_results.append(page)
                seen_urls.add(page.get("url"))

        merged["web"] = {
            "success": True,
            "results": existing_results,
            "results_found": len(existing_results),
            "context": existing_web.get("context", "")
            + "\n"
            + new_web.get("context", ""),
        }

        return merged

    # ==================== Outline planning ====================

    def _get_outline_prompt(self) -> str:
        """Return the system prompt for outline generation."""
        return """You are a research report planner. Create a concise outline for a focused research report.

## Requirements:

1. **Keep it simple** - Use flat structure with NO subsections
2. **Be concise** - Each section should be focused and digestible
3. **Cite sources** - Assign relevant references to each section

## Output Format (JSON):

```json
{
  "title": "Report Title",
  "abstract_points": ["key finding 1", "key finding 2"],
  "sections": [
    {
      "id": "section_1",
      "title": "Section Title",
      "level": 2,
      "description": "Brief description of what this section covers",
      "subsections": [],
      "relevant_refs": [1, 2]
    }
  ],
  "conclusion_points": ["conclusion 1", "conclusion 2"]
}
```

## Guidelines:
- Create **2-4 main sections** only (no more!)
- **NO subsections** - keep structure flat
- Each section should be concise and focused
- Match references to sections based on content relevance
- Think like a research briefing, not a textbook"""

    @api_retry
    async def _generate_outline(
        self,
        query: str,
        context: str,
    ) -> ReportOutline:
        """Generate a report outline."""
        ref_info = []
        for ref in self.ref_manager.get_all_references():
            if ref.ref_type == ReferenceType.ARXIV:
                ref_info.append(
                    f'[{ref.ref_id}] arXiv: "{ref.title}" - {ref.cited_content[:200]}...'
                )
            else:
                ref_info.append(
                    f'[{ref.ref_id}] Web: "{ref.title}" - {ref.cited_content[:200]}...'
                )

        ref_map_str = "\n".join(ref_info)

        user_message = f"""## Research Question
{query}

## Available References
{ref_map_str}

## Source Content Summary
{context[:4000]}

Please create a detailed outline for a comprehensive research report."""

        response = await self.llm_client.chat.completions.create(
            model=LLM_MODEL,
            messages=[
                {"role": "system", "content": self._get_outline_prompt()},
                {"role": "user", "content": user_message},
            ],
            response_format={"type": "json_object"},
            max_tokens=2000,
        )

        outline_data = json.loads(response.choices[0].message.content)

        # Parse sections
        def parse_section(data: dict, level: int = 2) -> ReportSection:
            subsections = []
            for sub_data in data.get("subsections", []):
                subsections.append(parse_section(sub_data, level + 1))

            return ReportSection(
                id=data.get("id", ""),
                title=data.get("title", ""),
                level=level,
                description=data.get("description", ""),
                subsections=subsections,
                relevant_refs=data.get("relevant_refs", []),
            )

        sections = [parse_section(s) for s in outline_data.get("sections", [])]

        return ReportOutline(
            title=outline_data.get("title", "Research Report"),
            abstract_points=outline_data.get("abstract_points", []),
            sections=sections,
            conclusion_points=outline_data.get("conclusion_points", []),
        )

    # ==================== Structured report generation ====================

    def _get_section_prompt(self) -> str:
        """Return the system prompt for section generation."""
        return """You are an expert research writer. Write a concise section for a research briefing.

## Requirements:

1. **Be Concise** - Write 2-4 focused paragraphs per section. Quality over quantity.

2. **Rich Elements** (use sparingly, only when truly helpful):
   - **Tables**: For clear comparisons only
   - **Formulas**: For key equations only (use $inline$ or $$block$$)
   - **Mermaid**: For critical workflows only

3. **Citations**: Cite sources using [1], [2], etc.

4. **Style**:
   - Direct and informative, like a research briefing
   - Avoid unnecessary elaboration
   - Focus on key insights and findings

Write ONLY the content for this section. Do NOT include the section title - it will be added automatically."""

    async def _generate_section_stream(
        self,
        section: ReportSection,
        query: str,
        context: str,
        previous_sections: str = "",
    ) -> AsyncGenerator[str, None]:
        """Stream a single section."""
        relevant_refs_info = []
        for ref_id in section.relevant_refs:
            ref = self.ref_manager.get_reference(ref_id)
            if ref:
                relevant_refs_info.append(
                    f'[{ref.ref_id}] "{ref.title}": {ref.cited_content[:300]}...'
                )

        refs_str = (
            "\n".join(relevant_refs_info)
            if relevant_refs_info
            else "Use any relevant references from the context."
        )

        user_message = f"""## Research Question
{query}

## Section to Write
Title: {section.title}
Description: {section.description}
Level: {"##" * (section.level - 1)} ({"main section" if section.level == 2 else "subsection"})

## Most Relevant References for This Section
{refs_str}

## Full Context
{context[:3000]}

## Previously Written Sections (for coherence)
{previous_sections[-1500:] if previous_sections else "This is the first section."}

Write the content for this section now. Include tables, formulas, or flowcharts where they add value."""

        response = await self.llm_client.chat.completions.create(
            model=LLM_MODEL,
            messages=[
                {"role": "system", "content": self._get_section_prompt()},
                {"role": "user", "content": user_message},
            ],
            max_tokens=1500,
            temperature=0.7,
            stream=True,
        )

        async for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
            # Collect usage from the last chunk (kept for future use)
            if hasattr(chunk, "usage") and chunk.usage:
                _stream_input_tokens = getattr(chunk.usage, "prompt_tokens", 0) or 0
                _stream_output_tokens = (
                    getattr(chunk.usage, "completion_tokens", 0) or 0
                )
                _stream_api_cost = getattr(chunk.usage, "cost", 0) or 0

    async def _generate_abstract_stream(
        self,
        outline: ReportOutline,
        query: str,
        context: str,
    ) -> AsyncGenerator[str, None]:
        """Stream the abstract."""

        points_str = "\n".join(f"- {p}" for p in outline.abstract_points)

        user_message = f"""## Research Question
{query}

## Key Points to Cover
{points_str}

## Context
{context[:2000]}

Write a concise but comprehensive abstract (2-3 paragraphs) that summarizes the key findings and contributions of this research report."""

        response = await self.llm_client.chat.completions.create(
            model=LLM_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert at writing academic abstracts. Write a clear, informative abstract that captures the essence of the research. Use citations [1], [2] where appropriate.",
                },
                {"role": "user", "content": user_message},
            ],
            max_tokens=500,
            temperature=0.7,
            stream=True,
        )

        async for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
            # Collect usage from the last chunk (kept for future use)
            if hasattr(chunk, "usage") and chunk.usage:
                _stream_input_tokens = getattr(chunk.usage, "prompt_tokens", 0) or 0
                _stream_output_tokens = (
                    getattr(chunk.usage, "completion_tokens", 0) or 0
                )
                _stream_api_cost = getattr(chunk.usage, "cost", 0) or 0

    async def _generate_conclusion_stream(
        self,
        outline: ReportOutline,
        query: str,
        full_report: str,
    ) -> AsyncGenerator[str, None]:
        """Stream the conclusion."""

        points_str = "\n".join(f"- {p}" for p in outline.conclusion_points)

        user_message = f"""## Research Question
{query}

## Key Conclusion Points
{points_str}

## Full Report Content
{full_report[-3000:]}

Write a comprehensive conclusion that:
1. Summarizes the main findings
2. Highlights key insights and implications
3. Suggests future research directions"""

        response = await self.llm_client.chat.completions.create(
            model=LLM_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert at writing research conclusions. Synthesize the findings into a clear, impactful conclusion.",
                },
                {"role": "user", "content": user_message},
            ],
            max_tokens=800,
            temperature=0.7,
            stream=True,
        )

        async for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
            # Collect usage from the last chunk (kept for future use)
            if hasattr(chunk, "usage") and chunk.usage:
                _stream_input_tokens = getattr(chunk.usage, "prompt_tokens", 0) or 0
                _stream_output_tokens = (
                    getattr(chunk.usage, "completion_tokens", 0) or 0
                )
                _stream_api_cost = getattr(chunk.usage, "cost", 0) or 0

        # Note: we still collect token usage from the final stream chunk (OpenRouter),
        # but the OSS variant does not perform any payments/credits logic here.

    # ==================== Simple report generation ====================

    def _get_report_prompt(self) -> str:
        """Return the system prompt for report generation."""
        return """You are an expert research assistant. Write a concise research briefing based on the provided sources.

## Requirements:

1. **Structure**: Write a focused report in Markdown with:
   - A clear title (# Title)
   - A brief summary (2-3 sentences)
   - **2-4 sections only** with headers (## only, no ###)
   - A short conclusion

2. **Citations**: Cite sources using [1], [2], etc.
   - Every factual claim must have a citation
   - Use exact reference IDs from sources

3. **Style**:
   - Be concise and direct
   - Focus on key insights, not exhaustive coverage
   - Each section: 2-4 paragraphs max

4. **Rich Elements** (use sparingly):
   - Tables only for clear comparisons
   - Formulas only for key equations

## IMPORTANT:
- Keep sections flat (no subsections)
- Quality over quantity
- Think research briefing, not textbook

Write the report now. Do NOT include a References section - it will be added automatically."""

    async def _generate_report_stream(
        self,
        query: str,
        context: str,
    ) -> AsyncGenerator[str, None]:
        """Stream the research report (simple mode)."""
        ref_info = []
        for ref in self.ref_manager.get_all_references():
            if ref.ref_type == ReferenceType.ARXIV:
                authors_str = ", ".join(ref.authors[:2]) if ref.authors else ""
                ref_info.append(
                    f'[{ref.ref_id}] arXiv paper: "{ref.title}" by {authors_str} ({ref.year})'
                )
            else:
                ref_info.append(f'[{ref.ref_id}] Web: "{ref.title}"')

        ref_map_str = "\n".join(ref_info)

        user_message = f"""## Research Question
{query}

## Available Reference IDs
{ref_map_str}

## Source Content
{context}

Please write a comprehensive research report addressing the research question. Remember to cite sources using [1], [2], etc."""

        response = await self.llm_client.chat.completions.create(
            model=LLM_MODEL,
            messages=[
                {"role": "system", "content": self._get_report_prompt()},
                {"role": "user", "content": user_message},
            ],
            max_tokens=4000,
            temperature=0.7,
            stream=True,
        )

        async for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
            # Collect usage from the last chunk (kept for future use)
            if hasattr(chunk, "usage") and chunk.usage:
                _stream_input_tokens = getattr(chunk.usage, "prompt_tokens", 0) or 0
                _stream_output_tokens = (
                    getattr(chunk.usage, "completion_tokens", 0) or 0
                )
                _stream_api_cost = getattr(chunk.usage, "cost", 0) or 0

        # Note: token usage is collected from the final stream chunk (OpenRouter),
        # but the OSS variant does not perform any payments/credits logic here.

    # ==================== Main entry: streaming output ====================

    async def research_stream(
        self,
        query: str,
        arxiv_papers: int = 5,
        web_pages: int = 8,
        structured: bool = False,
    ) -> AsyncGenerator[ResearchEvent, None]:
        """
        Execute deep research (streaming).

        Args:
            query: Research question
            arxiv_papers: Number of arXiv papers
            web_pages: Number of web pages
            structured: Whether to use structured mode (outline + section streaming)

        Yields:
            ResearchEvent: research event
        """
        if structured:
            async for event in self._research_stream_structured(
                query, arxiv_papers, web_pages
            ):
                yield event
        else:
            async for event in self._research_stream_simple(
                query, arxiv_papers, web_pages
            ):
                yield event

    async def _research_stream_simple(
        self,
        query: str,
        arxiv_papers: int = 5,
        web_pages: int = 8,
    ) -> AsyncGenerator[ResearchEvent, None]:
        """Simple mode: multi-iteration search + direct report generation."""
        yield ResearchEvent(
            type=EventType.PROGRESS,
            message="Starting deep research...",
            data={"query": query},
        )

        # Reset reference manager
        self.ref_manager = ReferenceManager()
        all_search_results = {"arxiv": {}, "web": {}}

        # ========== Multi-iteration search ==========
        for iteration in range(self.max_iterations):
            search_query = query if iteration == 0 else None

            if iteration == 0:
                yield ResearchEvent(
                    type=EventType.ITERATION,
                    message=f"Round {iteration + 1}: Initial search",
                    data={"iteration": iteration + 1, "query": query},
                )
            else:
                # Analyze knowledge gaps
                yield ResearchEvent(
                    type=EventType.ANALYSIS,
                    message="Analyzing knowledge gaps...",
                )

                current_context = self._process_references(all_search_results)
                follow_up_queries = await self._analyze_knowledge_gaps(
                    query, current_context
                )

                if not follow_up_queries:
                    yield ResearchEvent(
                        type=EventType.ANALYSIS,
                        message="Knowledge is comprehensive, no additional search needed",
                    )
                    break

                search_query = follow_up_queries[0]
                yield ResearchEvent(
                    type=EventType.ITERATION,
                    message=f"Round {iteration + 1}: Follow-up search",
                    data={
                        "iteration": iteration + 1,
                        "query": search_query,
                        "reason": "filling knowledge gaps",
                    },
                )

            # Search
            yield ResearchEvent(
                type=EventType.SEARCH_START,
                message=f"Searching: {search_query}",
                data={"query": search_query},
            )

            search_results = await self._search_all(
                query=search_query,
                arxiv_papers=arxiv_papers if iteration == 0 else 3,
                web_pages=web_pages if iteration == 0 else 4,
            )

            arxiv_count = search_results.get("arxiv", {}).get("papers_found", 0)
            web_count = search_results.get("web", {}).get("results_found", 0)

            yield ResearchEvent(
                type=EventType.SEARCH_RESULT,
                message=f"Found: {arxiv_count} papers, {web_count} web pages",
                data={
                    "arxiv_count": arxiv_count,
                    "web_count": web_count,
                    "iteration": iteration + 1,
                },
            )

            # Merge results
            if iteration == 0:
                all_search_results = search_results
            else:
                all_search_results = self._merge_search_results(
                    all_search_results, search_results
                )

        # ========== Process references ==========
        yield ResearchEvent(
            type=EventType.PROGRESS,
            message="Processing references...",
        )

        context = self._process_references(all_search_results)

        if not context.strip():
            yield ResearchEvent(
                type=EventType.ERROR,
                message="No sources found!",
            )
            return

        # ========== Generate report ==========
        yield ResearchEvent(
            type=EventType.REPORT_START,
            message="Generating research report...",
            data={"total_refs": self.ref_manager.total_count},
        )

        report_content = ""
        async for chunk in self._generate_report_stream(query, context):
            report_content += chunk
            yield ResearchEvent(
                type=EventType.REPORT_CHUNK, message="", data={"chunk": chunk}
            )

        # ========== Done ==========
        report = ResearchReport(
            query=query,
            report_markdown=report_content,
            references=self.ref_manager.get_all_references(),
            arxiv_count=self.ref_manager.arxiv_count,
            web_count=self.ref_manager.web_count,
        )

        yield ResearchEvent(
            type=EventType.REPORT_DONE,
            message="Report generated!",
            data={"report": report.to_dict()},
        )

        yield ResearchEvent(
            type=EventType.DONE,
            message=f"Research complete! {report.arxiv_count} papers, {report.web_count} web sources",
            data={
                "arxiv_count": report.arxiv_count,
                "web_count": report.web_count,
                "bibtex": report.get_bibtex(),
                "references_markdown": report.get_references_markdown(),
            },
        )

    async def _research_stream_structured(
        self,
        query: str,
        arxiv_papers: int = 5,
        web_pages: int = 8,
    ) -> AsyncGenerator[ResearchEvent, None]:
        """Structured mode: multi-iteration + outline planning + section streaming."""
        yield ResearchEvent(
            type=EventType.PROGRESS,
            message="Starting deep research (structured mode)...",
            data={"query": query},
        )

        # Reset reference manager
        self.ref_manager = ReferenceManager()
        all_search_results = {"arxiv": {}, "web": {}}

        # ========== Multi-iteration search (same as simple mode) ==========
        for iteration in range(self.max_iterations):
            search_query = query if iteration == 0 else None

            if iteration == 0:
                yield ResearchEvent(
                    type=EventType.ITERATION,
                    message=f"Round {iteration + 1}: Initial search",
                    data={"iteration": iteration + 1, "query": query},
                )
            else:
                yield ResearchEvent(
                    type=EventType.ANALYSIS,
                    message="Analyzing knowledge gaps...",
                )

                current_context = self._process_references(all_search_results)
                follow_up_queries = await self._analyze_knowledge_gaps(
                    query, current_context
                )

                if not follow_up_queries:
                    yield ResearchEvent(
                        type=EventType.ANALYSIS,
                        message="Knowledge is comprehensive, no additional search needed",
                    )
                    break

                search_query = follow_up_queries[0]
                yield ResearchEvent(
                    type=EventType.ITERATION,
                    message=f"Round {iteration + 1}: Follow-up search",
                    data={
                        "iteration": iteration + 1,
                        "query": search_query,
                        "reason": "filling knowledge gaps",
                    },
                )

            yield ResearchEvent(
                type=EventType.SEARCH_START,
                message=f"Searching: {search_query}",
                data={"query": search_query},
            )

            search_results = await self._search_all(
                query=search_query,
                arxiv_papers=arxiv_papers if iteration == 0 else 3,
                web_pages=web_pages if iteration == 0 else 4,
            )

            arxiv_count = search_results.get("arxiv", {}).get("papers_found", 0)
            web_count = search_results.get("web", {}).get("results_found", 0)

            yield ResearchEvent(
                type=EventType.SEARCH_RESULT,
                message=f"Found: {arxiv_count} papers, {web_count} web pages",
                data={
                    "arxiv_count": arxiv_count,
                    "web_count": web_count,
                    "iteration": iteration + 1,
                },
            )

            if iteration == 0:
                all_search_results = search_results
            else:
                all_search_results = self._merge_search_results(
                    all_search_results, search_results
                )

        # ========== Process references ==========
        yield ResearchEvent(
            type=EventType.PROGRESS,
            message="Processing references...",
        )

        context = self._process_references(all_search_results)

        if not context.strip():
            yield ResearchEvent(
                type=EventType.ERROR,
                message="No sources found!",
            )
            return

        # ========== Generate outline ==========
        yield ResearchEvent(
            type=EventType.OUTLINE_START,
            message="Planning report structure...",
        )

        try:
            outline = await self._generate_outline(query, context)
            yield ResearchEvent(
                type=EventType.OUTLINE_DONE,
                message=f"Outline ready: {len(outline.sections)} sections planned",
                data={"outline": outline.to_dict()},
            )
        except Exception as e:
            self._log(f"Outline generation failed: {e}, falling back to simple mode")
            # Fall back to simple mode
            yield ResearchEvent(
                type=EventType.REPORT_START,
                message="Generating report (simple mode)...",
            )

            report_content = ""
            async for chunk in self._generate_report_stream(query, context):
                report_content += chunk
                yield ResearchEvent(
                    type=EventType.REPORT_CHUNK, message="", data={"chunk": chunk}
                )

            report = ResearchReport(
                query=query,
                report_markdown=report_content,
                references=self.ref_manager.get_all_references(),
                arxiv_count=self.ref_manager.arxiv_count,
                web_count=self.ref_manager.web_count,
            )

            yield ResearchEvent(
                type=EventType.REPORT_DONE,
                message="Report generated!",
                data={"report": report.to_dict()},
            )
            yield ResearchEvent(
                type=EventType.DONE,
                message=f"Research complete! {report.arxiv_count} papers, {report.web_count} web sources",
                data={
                    "arxiv_count": report.arxiv_count,
                    "web_count": report.web_count,
                    "bibtex": report.get_bibtex(),
                    "references_markdown": report.get_references_markdown(),
                },
            )
            return

        # ========== Structured report generation ==========
        yield ResearchEvent(
            type=EventType.REPORT_START,
            message="Generating structured report...",
            data={
                "total_refs": self.ref_manager.total_count,
                "sections": len(outline.sections),
            },
        )

        full_report = ""

        # 1. Title
        title_md = f"# {outline.title}\n\n"
        full_report += title_md
        yield ResearchEvent(
            type=EventType.REPORT_CHUNK, message="", data={"chunk": title_md}
        )

        # 2. Abstract
        yield ResearchEvent(
            type=EventType.SECTION_START,
            message="Writing Abstract...",
            data={"section": "abstract"},
        )

        full_report += "## Abstract\n\n"
        yield ResearchEvent(
            type=EventType.REPORT_CHUNK, message="", data={"chunk": "## Abstract\n\n"}
        )

        async for chunk in self._generate_abstract_stream(outline, query, context):
            full_report += chunk
            yield ResearchEvent(
                type=EventType.SECTION_CHUNK,
                message="",
                data={"chunk": chunk, "section": "abstract"},
            )

        full_report += "\n\n"
        yield ResearchEvent(
            type=EventType.REPORT_CHUNK, message="", data={"chunk": "\n\n"}
        )

        yield ResearchEvent(
            type=EventType.SECTION_DONE,
            message="Abstract complete",
            data={"section": "abstract"},
        )

        # 3. Sections
        async def generate_section_recursive(section: ReportSection, depth: int = 0):
            nonlocal full_report

            header_prefix = "#" * (section.level + 1)
            section_header = f"{header_prefix} {section.title}\n\n"
            full_report += section_header

            yield ResearchEvent(
                type=EventType.SECTION_START,
                message=f"Writing: {section.title}",
                data={
                    "section": section.id,
                    "title": section.title,
                    "level": section.level,
                },
            )
            yield ResearchEvent(
                type=EventType.REPORT_CHUNK, message="", data={"chunk": section_header}
            )

            section_content = ""
            async for chunk in self._generate_section_stream(
                section, query, context, full_report
            ):
                section_content += chunk
                full_report += chunk
                yield ResearchEvent(
                    type=EventType.SECTION_CHUNK,
                    message="",
                    data={"chunk": chunk, "section": section.id},
                )

            full_report += "\n\n"
            yield ResearchEvent(
                type=EventType.REPORT_CHUNK, message="", data={"chunk": "\n\n"}
            )

            section.content = section_content

            yield ResearchEvent(
                type=EventType.SECTION_DONE,
                message=f"{section.title} complete",
                data={"section": section.id},
            )

            # Recurse into subsections
            for subsection in section.subsections:
                async for event in generate_section_recursive(subsection, depth + 1):
                    yield event

        for section in outline.sections:
            async for event in generate_section_recursive(section):
                yield event

        # 4. Conclusion
        yield ResearchEvent(
            type=EventType.SECTION_START,
            message="Writing Conclusion...",
            data={"section": "conclusion"},
        )

        conclusion_header = "## Conclusion\n\n"
        full_report += conclusion_header
        yield ResearchEvent(
            type=EventType.REPORT_CHUNK, message="", data={"chunk": conclusion_header}
        )

        async for chunk in self._generate_conclusion_stream(
            outline, query, full_report
        ):
            full_report += chunk
            yield ResearchEvent(
                type=EventType.SECTION_CHUNK,
                message="",
                data={"chunk": chunk, "section": "conclusion"},
            )

        full_report += "\n"
        yield ResearchEvent(
            type=EventType.REPORT_CHUNK, message="", data={"chunk": "\n"}
        )

        yield ResearchEvent(
            type=EventType.SECTION_DONE,
            message="Conclusion complete",
            data={"section": "conclusion"},
        )

        # ========== Done ==========
        report = ResearchReport(
            query=query,
            report_markdown=full_report,
            references=self.ref_manager.get_all_references(),
            arxiv_count=self.ref_manager.arxiv_count,
            web_count=self.ref_manager.web_count,
        )

        yield ResearchEvent(
            type=EventType.REPORT_DONE,
            message="Structured report generated!",
            data={"report": report.to_dict(), "outline": outline.to_dict()},
        )

        yield ResearchEvent(
            type=EventType.DONE,
            message=f"Research complete! {report.arxiv_count} papers, {report.web_count} web sources",
            data={
                "arxiv_count": report.arxiv_count,
                "web_count": report.web_count,
                "bibtex": report.get_bibtex(),
                "references_markdown": report.get_references_markdown(),
            },
        )


__all__ = ["DeepResearchService", "ResearchEvent", "EventType"]
