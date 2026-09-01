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

## The editor sidebar is Claude Code holding the app's own MCP server
`WorkTheDrawing` is the editor dock's turn. It reuses `RunClaudeCode` (the one CLI wrapper — never add a second) with a `$tools` list, which attaches this app as an MCP server via `--mcp-config` + `--strict-mcp-config` (strict matters: otherwise the repo's own .mcp.json loads too) and allows only `mcp__vanhaven__*`.

Ask vs Build is a *tool* boundary, not an instruction: Ask gets `WorkTheDrawing::READING` and physically cannot draw. Never enforce it in the brief alone.

`RunClaudeCode::FORBIDDEN` denies Bash/Read/Write/WebFetch/Task. The app serves itself from a working copy of its own source and the CLI runs on the host's account, so deny rules (which beat allow rules, including a permissive ~/.claude/settings.json) are the only thing keeping a chat about a drawing away from the filesystem. Do not trim that list.

Changes shown in the sidebar are diffed off the before/after documents, never off what Claude says it did. Diff against the NORMALIZED lent copy or `BuildStarterDocument`'s backfilled type catalogues read as work Claude did.

## Every Claude Code turn runs as the person who asked, never the host
`RunClaudeCode::handle()` takes a `ClaudeAccount` as its FIRST argument — there is no path through the class that borrows the host machine's keychain sign-in. Keep it that way: the type is the enforcement. `isReadyFor(User)` is the gate; `isAvailable()` alone only means the binary exists.

The token is a subscription token from `claude setup-token`, kept in `claude_accounts` (one per user, encrypted cast, `#[Hidden]`), NOT in `ai_connections` — that table is API keys for providers we POST JSON to, and `DraftItemParts` throws on a provider it cannot speak to.

It is passed via `Process::env()`, never on the command line, so it stays out of process lists and crash logs. `ANTHROPIC_API_KEY` is blanked in the same env: if the host has one exported the CLI would silently use it and bill the machine owner's API account instead of the asker's plan. Tests assert both.

`ClaudeAccountController::store` verifies with a real one-word turn before saving. Do not make it store-and-hope — the failure just moves somewhere less explicable.

## PHP_BINARY is not a CLI in a web request — never spawn Artisan with it
The sidebar starts our MCP server as `<php> artisan mcp:start cad`. In a web request `PHP_BINARY` is whatever is serving the app: `php-cgi.exe` under Herd, `php-fpm` on most Linux hosts. Neither takes a script plus arguments the way the CLI does — `php-cgi artisan mcp:start cad` swallows the arguments and exits 255 — and the ONLY symptom is Claude saying "the vanhaven MCP server failed to connect", which points nowhere near the cause.

`RunClaudeCode::phpBinary()` resolves it: `services.claude_code.php` if set, else `PHP_BINARY` when its basename really is php/php.exe, else the CLI sitting beside it, else `php` from PATH.

Tests cannot catch a regression here — under Pest, `PHP_BINARY` is already the CLI, so the assertion passes either way. To verify a change, run the resolver under php-cgi directly (`php-cgi -f` a script that reflects into the method) and check it comes back with php.exe. Same trap applies to any other place that shells out to Artisan from a request.
