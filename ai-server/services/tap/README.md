# TAP - LaTeX code completion service

TAP (Type-Ahead Prediction) provides intelligent LaTeX code completion.

## For algorithm researchers

### What you should focus on

The core algorithm lives in the LLM call section of `service.py`.

**Input**:
- `prefix`: text before the cursor
- `suffix`: text after the cursor

**Output (this is what you should make the model output)**:
```json
{
  "action": "insert" | "complete_word" | "fix" | "skip",
  "confidence": 0.0-1.0,
  "inserted_text": "text to insert",
  "corrections": [
    {"search": "wrong text", "replace": "correct text", "location": "prefix|suffix"}
  ]
}
```

### What you don't need to worry about

These are fixed post-processing steps and do not affect the algorithm:

1. **Boundary extraction**: smartly slice prefix/suffix into suitable windows
2. **Scenario detection**: detect whether it's word completion, continuation, etc.
3. **Boundary fixups**: fix spacing issues around inserted text
4. **Diff computation**: compute prefix_diff and suffix_diff

## Flow diagram

```
User input (prefix, suffix)
         ↓
┌─────────────────────────────────┐
│ Fixed: boundary extraction,     │
│        scenario detection       │
└─────────────────────────────────┘
         ↓
┌─────────────────────────────────┐
│ [Core algorithm] LLM call       │
│  - Input: sliced context        │
│  - Output: action, inserted_text│
└─────────────────────────────────┘
         ↓
┌─────────────────────────────────┐
│ Fixed: boundary fixups,         │
│        diff computation         │
└─────────────────────────────────┘
         ↓
Return to frontend (prefix_diff, inserted_text, suffix_diff)
```

## Examples

### Case 1: Normal insertion

```
prefix: "The experiment shows"
suffix: " in Table 1"
       ↓
Model output: {"action": "insert", "inserted_text": " significant improvements"}
       ↓
Final result: "The experiment shows significant improvements in Table 1"
```

### Case 2: Word completion

```
prefix: "We propose De"
suffix: ""
       ↓
Model output: {"action": "complete_word", "inserted_text": "epCode"}
       ↓
Final result: "We propose DeepCode"  (note: no extra space)
```

### Case 3: Fixing a typo

```
prefix: "Teh experiment shows"
suffix: ""
       ↓
Model output: {
  "action": "insert",
  "inserted_text": " promising results.",
  "corrections": [{"search": "Teh", "replace": "The", "location": "prefix"}]
}
       ↓
Final result: "The experiment shows promising results."
```

## API

```
POST /api/tap/complete
Content-Type: application/json

{
  "prefix": "The experiment shows",
  "suffix": " in Table 1"
}

Response:
{
  "should_complete": true,
  "confidence": 0.85,
  "latency_ms": 523,
  "proposed_changes": {
    "prefix_diff": [{"op": "equal", "text": "The experiment shows"}],
    "inserted_text": " significant improvements",
    "suffix_diff": [{"op": "equal", "text": " in Table 1"}]
  }
}
```

## Modifying the algorithm

To modify the completion algorithm:

1. Modify `_build_prompt()` to change the prompt
2. Modify output parsing to support new fields
3. Keep the output schema (action, confidence, inserted_text, corrections)

The post-processing steps (boundary fixups, diff computation) do not need changes.
