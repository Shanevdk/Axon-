---
paths:
  - 'app/Mcp/**'
---

# Mcp

## CAD MCP server mirrors editor semantics, all lengths in mm
The `cad` MCP server (routes/ai.php, started via `php artisan mcp:start cad`, registered in .mcp.json) lets AI clients edit model documents. Tools must mirror the editor's semantics, not invent their own: read documents through BuildStarterDocument::normalize() (the MutatesDocuments trait does this), clamp openings inside their host like clampOpeningParameter, delete hosted openings with their wall, and number rooms by level-hundreds. Every length is millimetres. On laravel/mcp 0.9, Response::structured() returns ResponseFactory — declare handle(): Response|ResponseFactory.
