---
paths:
  - 'app/Mcp/**'
---

# Mcp

## CAD MCP server mirrors editor semantics, all lengths in mm
The `cad` MCP server (routes/ai.php, started via `php artisan mcp:start cad`, registered in .mcp.json) lets AI clients edit model documents. Tools must mirror the editor's semantics, not invent their own: read documents through BuildStarterDocument::normalize() (the MutatesDocuments trait does this), clamp openings inside their host like clampOpeningParameter, delete hosted openings with their wall, and number rooms by level-hundreds. Every length is millimetres. On laravel/mcp 0.9, Response::structured() returns ResponseFactory — declare handle(): Response|ResponseFactory.

## ModelBench: how a local-first drawing gets edited by MCP at all
Once a drawing is local the server holds only a preview, so `refuseIfAway()` blocks edits. The editor sidebar gets round it honestly: for the length of one turn the browser lends the whole live document to `ModelBench` (cache, 15 min TTL), and the browser commits the result as one undo entry.

All three seams in `MutatesDocuments` — `refuseIfAway`, `documentFor`, `saveDocument` — check the bench first, so every tool follows the drawing without knowing the sidebar exists. Write new document tools through that trait and they inherit it; read `$project->document` directly and you will silently edit the preview.

The bench must live in a store shared across processes (database/file/redis, never `array` outside tests): the MCP server is a separate `php artisan mcp:start cad` spawned by the CLI.

## Every MCP tool must scope to the asker — the server is on the open internet now
The CAD server is reached three ways: HTTP connector (OAuth token, `auth:api`), the editor sidebar over stdio (names its user via `VANHAVEN_MCP_USER`), and a hand-run local `mcp:start cad`.

Use `ScopesToTheAsker` and go through `visibleProjects()` / `visibleLibraryItems()` / `visibleDesignBoards()`. A tool that writes `Project::query()->find(...)` hands one studio another studio's building — that was true of all twelve tools before this and is the single easiest way to reintroduce a leak. `asker()` checks the `api` guard BY NAME first; `auth()->user()` alone resolves the session guard, which a bearer-token request never touched.

Unnamed callers get `whereRaw('1 = 0')`, not everything. The only exception is a console (stdio) server, where the caller already has the database.

Never use `exists:projects,id` style rules on an id a caller supplies: a validation failure that differs from "not yours" is an existence oracle. Both refusals share one wording (`refuseUnknownProject()`), and there is a test asserting they are identical.

New records created by a tool belong to `asker()`, not to `User::query()->first()`.
