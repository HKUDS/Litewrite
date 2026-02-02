# DeepResearch - deep research report service

Generates comprehensive research reports by integrating arXiv papers and web search results.

## For algorithm researchers

### What you should focus on

The core algorithm is in these methods in `service.py`:

1. **`_search_all()`**: search strategy
   - how arXiv and web search are called
   - how results are merged

2. **`_generate_report_stream()`**: report generation
   - how the prompt is built
   - how references are organized

### What you don't need to worry about

1. **Event stream output**: just `yield ResearchEvent(...)`
2. **SSE formatting**: handled automatically
3. **Frontend rendering**: handled automatically

## Event types

```python
class EventType(Enum):
    PROGRESS = "progress"       # progress update
    SEARCH_START = "search_start"  # search started
    SEARCH_RESULT = "search_result"  # search results
    REPORT_START = "report_start"  # report generation started
    REPORT_CHUNK = "report_chunk"  # report content chunk
    REPORT_DONE = "report_done"  # report completed
    DONE = "done"  # all done
    ERROR = "error"  # error
```

## Flow diagram

```
User input (query)
         ↓
┌─────────────────────────────────┐
│ [Core algorithm] Search stage   │
│  - arXiv search                 │
│  - web search                   │
│  - merge results                │
└─────────────────────────────────┘
         ↓
     yield ResearchEvent(SEARCH_RESULT, ...)
         ↓
┌─────────────────────────────────┐
│ [Core algorithm] Report stage   │
│  - build prompt                 │
│  - stream LLM output            │
└─────────────────────────────────┘
         ↓
     yield ResearchEvent(REPORT_CHUNK, ...)
         ↓
Frontend renders automatically
```

## Example

```python
from services.deep_research import DeepResearchService

service = DeepResearchService()

async for event in service.research_stream("How do transformers work?"):
    if event.type == EventType.PROGRESS:
        print(f"Progress: {event.message}")
    elif event.type == EventType.REPORT_CHUNK:
        print(event.data["chunk"], end="", flush=True)
    elif event.type == EventType.DONE:
        print(f"\nDone! Cited {event.data['arxiv_count']} papers")
```

## API

```
POST /api/research/stream
Content-Type: application/json

{
  "query": "How do transformers work?",
  "arxiv_papers": 5,
  "web_pages": 5
}

Response: SSE event stream
event: progress
data: {"type": "progress", "message": "🚀 Starting research..."}

event: search_result
data: {"type": "search_result", "message": "📚 Found: 5 papers, 5 web pages"}

event: report_chunk
data: {"type": "report_chunk", "data": {"chunk": "# Research Report\n\n"}}

event: done
data: {"type": "done", "message": "✅ Done!", "data": {"arxiv_count": 5}}
```

## Modifying the algorithm

### Modify search strategy

```python
async def _search_all(self, query, ...):
    # Add new sources
    # Change search parameters
    # Change result merging logic
    pass
```

### Modify report generation

```python
async def _generate_report_stream(self, query, context):
    # Modify system prompt
    # Change report structure
    # Adjust citation format
    pass
```

As long as you keep the `yield ResearchEvent(...)` format, the frontend does not need changes.
