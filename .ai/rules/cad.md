---
paths:
  - 'resources/js/lib/cad/**'
  - resources/js/lib/cad/brief.ts
  - resources/js/lib/cad/vault.ts
---

# Cad

## Axon brand palette and type
ink #242424, sand #c2ab92 (primary accent), ember #f68b21 (CTA/links), paper #ffffff / #f7f5f2. Type is Karla, loaded via the `bunny()` font helper in vite.config.ts.

Use the semantic tokens (`bg-sand`, `text-ink-muted`, `bg-chrome`) rather than raw hex. The `chrome-*` tokens are the always-dark editor shell and are deliberately not theme-switched.

The palette was sampled from vanhaven.ca, the studio's own site, if you ever need to check it against the source — it returns 403 to plain fetches, so pass a browser User-Agent.</note>
</invoke>

## Model document saves are JSON, not Inertia
`projects.document.update` returns JSON rather than an Inertia redirect on purpose: the editor autosaves while the user is drawing, and an Inertia response would re-render the page and throw away in-flight canvas state.

The client hits it with plain `fetch` and the `X-XSRF-TOKEN` cookie (see `use-cad-editor.ts`). Keep it off the Inertia response path.</note>
</invoke>

## Selection controls live in manipulators.ts, in model space
Grips, flip arrows and temporary dimensions (Revit-style selection controls) are defined in `lib/cad/manipulators.ts` in model millimetres. `render-plan.ts` draws them and `drawing-canvas.tsx` hit-tests them from the same geometry — never compute their positions independently in either place, or picking and drawing drift apart. A TemporaryDimension carries its own `apply(document, mm)` closure so callers apply typed overrides without knowing the maths.

## Detail level drives symbol complexity, not visibility
Coarse/Medium/Fine mirror Revit: walls draw solid poché at Coarse and reveal derived compound layers (wallLayers() in model.ts) at Medium/Fine; doors show no swing at Coarse, a line leaf at Medium, a panel plus threshold at Fine; windows gain frames then double glazing and a sill. Layers are derived from WallType, never stored in the document — keep it that way so old documents render correctly.

## Adding an element kind touches six switch points
A new CadElement kind must be covered in: types.ts (union + ToolId if placeable), model.ts (HIT_PRIORITY, elementContainsPoint, transformElement, elementDisplayName, elementCategory), render-plan.ts (a draw pass wired into drawPlan), solids.ts (a solid builder + SolidCategory + material maps in mesh.ts AND exchange/obj.ts), manipulators.ts (grips), and drawing-canvas.tsx (elementPoints + a placement flow). TypeScript catches the Record maps but NOT hit-test/transform/grips — missing those fails silently. Modify-tab geometry ops live in modify.ts as pure document transforms with tests.

## The render brief is measured in the browser, never trusted on the server
`describeDesign()` reads the live `CadDocument` in the editor — including unsaved work — and turns it into fact chips plus a prompt sentence. `renderPrompt()` then wraps it with the lighting phrase and the standing "only this one building, no people, no text" clause. The server takes the finished prompt as free text and only bounds its length; it does not re-derive geometry, so any new fact belongs here, not in PHP.

Image generation goes to Pollinations (`config('services.pollinations')`) — free, no API key, one model (`sana`). There is no free image model on OpenRouter, so do not try to route renders through `AskOpenRouter`.

Image-to-image from the 3D view is not possible: Pollinations needs a publicly reachable URL for the reference image, which a localhost canvas capture is not.

## Drawings live on the machine, the server keeps a preview
The full `CadDocument` is held in IndexedDB (`vault.ts`, database `axon`, store `drawings`, keyed by project id) and autosaved ~250ms after every change. The server gets a one-level preview (`preview.ts` `buildPreview`) plus counts for the whole model (`summarise`) on a 1.5s beat, so `projects.document` is a thumbnail, not the model.

`projects.has_local_model` is the switch. False means the stored document is still the whole model and the editor adopts it into the vault on first open — that is how old projects and new ones migrate themselves. Once true, `ProjectController@show` sends `document: null` and the editor must find it locally or ask for the file.

Never count or edit `$project->document` server-side when `has_local_model` is true: use the `summary` column for counts, and MCP tools call `refuseIfAway()` because the editor's next publish would silently overwrite any write. Transfer between machines is `transfer.ts` — download the `.axon.json`, open it on the other computer.
