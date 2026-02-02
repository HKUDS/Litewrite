# Chat Service 1.5

Litewrite AI's Agent architecture implementation, using a MainAgent + SubAgent pattern.

## Prompt Format

### Message structure overview

```
[SYSTEM] System Prompt (role definition + tool documentation)

[SYSTEM] <context>                    ← Optional: previous conversation history
# Previous Conversation
User: ...
Assistant: ...
</context>

[USER] <goal>                         ← Current user request
The user's question or task
</goal>

[SYSTEM] <execution_log turn="1">     ← Execution log for this turn
[YOUR ACTION]:
...

[RESULT]:
...
</execution_log>
Continue based on the above...
```

### What the three tags are for

| Tag | Purpose | Source |
|------|------|------|
| `<context>` | Background from previous conversation | Next.js session history |
| `<goal>` | The task to complete right now | Current user request |
| `<execution_log>` | Actions and results already executed this turn | Produced inside the agent loop |

---

## `<context>` - conversation history

From Next.js session history, including:
- the user's previous queries
- the AI's previous replies
- **does not include** tool calls and tool results

**Purpose**: provide session context so the LLM knows what was discussed before.

**Where handled**: `_inject_history()` in `service.py`

---

## `<goal>` - current task

The user's current request, including:
- the user's input text
- file references (e.g. `[[FILE:main.tex:16-19]]`)

**Purpose**: make the current objective explicit.

**Where handled**: `run()` in `base.py`

---

## `<execution_log>` - execution log

Execution progress for the current task, including:
- `[YOUR ACTION]`: the LLM's previous outputs (including tool calls)
- `[RESULT]`: the results of tool execution

**Purpose**: ensure the LLM knows what it already did, avoiding repeated work.

**Where handled**: `_update_history_with_tool_calls()` in `base.py`

**Example**:

```xml
<execution_log turn="1">
[YOUR ACTION]:
I will read the file to see the content.

```json
{"tool": "read_file", "params": {"file_path": "main.tex", "start_line": 16, "end_line": 19}}
```

[RESULT]:
[Tool Result: read_file - Success]
Content of main.tex (lines 16-19):

[Line 16] Knowledge is as vast and boundless as the ocean,
[Line 17] In every spray of waves, new wisdom dwells.
</execution_log>

Continue based on the above execution log. Analyze the results and decide your NEXT action.
Do NOT repeat actions that already have results above.
```

---

## Design rationale

### Why separate `<context>` and `<execution_log>`?

They represent different kinds of history:

| Aspect | `<context>` | `<execution_log>` |
|------|-------------|-------------------|
| Content | what the user asked and what the AI replied | tool calls and results |
| State | completed conversation | in-progress task execution |
| Purpose | background context | deciding the next step |
| Source | Redis session → Next.js | inside the agent loop |

### Why use `[YOUR ACTION]` instead of `[ASSISTANT]`?

It emphasizes that this is the LLM's **own previous output**, not another role's message.
This helps the LLM realize: "I've already done this action; I shouldn't repeat it."

---

## Architecture

```
ChatService (service.py)
    ├── Receive requests from Next.js
    ├── Inject history → <context>
    └── Call MainAgent

MainAgent (agents/main_agent.py)
    ├── Extends BaseAgent
    ├── Defines the system prompt
    └── Defines available tools

BaseAgent (agents/base.py)
    ├── Core agent loop logic
    ├── Message history management
    ├── Tool execution
    └── LLM calls
```

## File structure

```
chat_1_5/
├── service.py          # Entry service
├── agents/
│   ├── base.py         # BaseAgent base class
│   ├── main_agent.py   # MainAgent implementation
│   ├── registry.py     # Agent registration
│   └── tool_parser.py  # Tool call parsing
├── prompts/
│   └── main_agent.py   # System prompts
├── subagents/          # SubAgent implementations
└── README.md           # This document
```
