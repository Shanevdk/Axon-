---
paths:
  - resources/js/components/library/design-terminal.tsx
  - resources/js/components/library/designer-viewport.tsx
---

# Components Library

## The designer terminal: say/parts protocol, prose never breaks it
The designer's AI box is a terminal (`design-terminal.tsx` + `library.terminal` endpoint + `DraftItemParts::converse`). Protocol: the model replies one JSON object `{say, parts|null, name, category}`; `parts` replaces the whole board and is validated/normalised through the shared `CompileItemParts` pair like every author. Two resilience rules that must survive refactors: a bare-prose reply becomes `say` (the conversation never 500s on a chatty model), and unbuildable parts return `refused` text alongside the talk — the board is left alone, the turn still succeeds.

The transcript lives in the browser (like every assistant here), clipped to 20 turns server-side; the board rides in the system prompt each turn, so `/clear` forgets the talk but not the board. Local slash commands (/help /connect /use /parts /clear) are handled entirely client-side — never send them to the model.

## The designer viewport shades compiled pieces — never recompile per frame
`compileScene()` is the single compile: it returns the whole-item `mesh` for the document AND per-part `pieces` carrying each part's triangles already shifted by the same normalise() offset. The viewport shades pieces; the payload stores the mesh. `compileParts()` is now just `compileScene().mesh` — keep it that way so the two can never disagree about where a part sits.

The viewport is painter's-algorithm on a 2D canvas, same as the editor's 3D view: project, back-face cull against the camera direction, sort by depth, fill. It re-projects from `scene` on every camera change — do not rebuild the scene there, memo it in the page (`useMemo` on name+parts) or every drag frame recompiles the geometry.

`colour` on ItemPart is optional and falls back to `DEFAULT_PART_COLOUR`; `readHex()` never throws, because a colour can arrive from an AI draft. PHP mirrors this in `CompileItemParts::partRules()` (`regex:/^#[0-9a-fA-F]{6}$/`) and lower-cases it in `normaliseParts()`. Both AI briefs list the material hexes so drafts arrive already coloured.
