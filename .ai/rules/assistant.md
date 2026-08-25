---
paths:
  - 'app/Actions/Assistant/**'
---

# Assistant

## The assistant is stateless — the browser owns the transcript
Nothing about a conversation is persisted. `assistant.tsx` keeps the turns in React state and posts the whole list to `assistant.reply`, which forwards the tail (`AskOpenRouter::HISTORY_LIMIT`, 20 turns) plus the system brief to OpenRouter. Do not add a messages table without deciding retention first.

`AskOpenRouter` throws `RuntimeException` with a message meant for a person; `AssistantController` catches it and answers 503 with that text, which the page shows verbatim. Add new upstream statuses to `reasonFor()`, never leak the raw body.

The default `OPENROUTER_MODEL` is a `:free` slug. Free slugs get retired and are rate limited, so the model is config, never hard-coded, and the POST route is throttled at 20/min.
