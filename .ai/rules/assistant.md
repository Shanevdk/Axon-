---
paths:
  - 'app/Actions/Assistant/**'
  - app/Actions/Assistant/AskAboutTheBuilding.php
  - app/Actions/Assistant/DraftItemParts.php
  - app/Actions/Assistant/RunClaudeCode.php
---

# Assistant

## The assistant is stateless — the browser owns the transcript
Nothing about a conversation is persisted. `assistant.tsx` keeps the turns in React state and posts the whole list to `assistant.reply`, which forwards the tail (`AskOpenRouter::HISTORY_LIMIT`, 20 turns) plus the system brief to OpenRouter. Do not add a messages table without deciding retention first.

`AskOpenRouter` throws `RuntimeException` with a message meant for a person; `AssistantController` catches it and answers 503 with that text, which the page shows verbatim. Add new upstream statuses to `reasonFor()`, never leak the raw body.

The default `OPENROUTER_MODEL` is a `:free` slug. Free slugs get retired and are rate limited, so the model is config, never hard-coded, and the POST route is throttled at 20/min.

## The editor's code consultant is the same transport with a different brief
`AskOpenRouter::ask($systemPrompt, $messages)` is the shared transport — key check, history clip, `reasonFor()` wording. `handle()` is just `ask(self::SYSTEM_PROMPT, ...)`. A new assistant means a new brief, never a second HTTP client.

`AskAboutTheBuilding` composes three parts: the standing brief, where the building is, and a survey of the drawing. The survey is measured in the BROWSER (`resources/js/lib/cad/survey.ts`, `surveyBuilding()`) against the live document, because with local-first storage the server's copy is only a preview — never re-derive it in PHP. It is bounded at `SURVEY_LIMIT` in the request, the same way a render prompt is.

Jurisdiction lives on `projects.jurisdiction`, set either from the Project Information dialog or from the assistant's own "where is this building?" gate (`projects.jurisdiction.update`). When it is blank the brief instructs the model to ask rather than guess a code. Coordinates from "use my location" go through `NamePlace`, which rounds to 3 decimals and caches; it returns a jurisdiction only, never a street address.

The brief forbids inventing clause numbers and requires an "authority having jurisdiction" caveat. Do not soften either — the answers are read by people who build things.

## BYO-key AI drafts speak the shared part language, keys never leave the server
`ai_connections` holds a user's own provider keys (anthropic/openai/openrouter), encrypted cast + #[Hidden] — the key is never serialized, never sent to the browser, and connections are personal, not team-shared, because a key bills its owner. One row per (user, provider); `store` is an updateOrCreate rekey. Provider base URLs live in `config/services.php` so tests can point them at fakes.

`DraftItemParts` asks whichever provider with a strict JSON-only brief and parses by outermost braces (models add code fences no matter what). The reply is then validated with `CompileItemParts::partRules()` and normalised with `CompileItemParts::normaliseParts()` — the same shared pair the MCP `design-library-item` tool uses. Every server-side author of parts must go through that pair; never duplicate the rules inline.

Provider defaults live in `AiConnection::PROVIDERS` and the model is per-connection overridable — model names age fast, so never hard-code one at a call site.

## The designer terminal drives the local Claude Code CLI — subscription, not API
`claude` in the designer terminal shells out to the Claude Code CLI on the machine serving the app (`claude --print <prompt> --output-format json --max-turns 1 --append-system-prompt <brief>`), reading `result` and `session_id` from the JSON envelope. The CLI is already signed in, so this runs on the user's subscription — a Max/Pro plan cannot sign API calls, and this is the only path that spends no API credit.

Non-negotiables: the command is built as a LIST and run through the `Process` facade, never a shell string — the prompt is user input. Never pass `--bare`: it forces ANTHROPIC_API_KEY auth and ignores the OAuth keychain, defeating the whole point. `--max-turns 1` keeps a stray tool call from looping.

Gated by `services.claude_code.enabled`, defaulting to `app()->environment('local')`, because it runs a local binary on the host's account — on a shared deployment every user would spend the host's plan. `isAvailable()` probes `--version` and caches for 10 minutes; the designer passes it as `claudeCodeReady`.

The turn reuses `DraftItemParts::terminalBrief()` + `parseTerminal()` and settles through `LibraryItemController::settleTurn()`, so CLI and API paths speak one protocol and meet the same part rules. Tests use `Process::fake()`.
