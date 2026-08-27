---
paths:
  - 'resources/js/lib/cad/**'
  - resources/js/lib/cad/brief.ts
  - resources/js/lib/cad/vault.ts
  - resources/js/lib/cad/render-3d.ts
  - resources/js/lib/cad/model.ts
  - resources/js/lib/cad/checkup.ts
  - resources/js/lib/cad/library.ts
  - resources/js/lib/cad/cleanup.ts
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

## Element-kind switch points beyond the six, and the fixture pattern
Beyond the six switch points in the cad rule, a new element kind should also touch: `properties-palette.tsx` (VG_CATEGORIES plus a per-kind editor section), `options-bar.tsx` (per-tool fields or a hint), and `levelBounds` in `use-cad-editor.ts` (or Zoom Fit ignores it). `preview.ts` DRAWABLE is deliberately narrow — only extend it if the server thumbnail should draw the kind.

Point-based components (equipment, lighting, plumbing, furniture, planting, parking) are ONE kind, `fixture`, with a `category` driving symbol, solid and defaults from `FIXTURE_PRESETS` in model.ts. Do not add a new kind for a new placeable thing — add a `FixtureCategory`. Ribbon buttons arm it via `{ kind: 'tool', tool: 'fixture', fixture: category }`; both dispatchers in `pages/projects/editor.tsx` call `setFixtureCategory` first.

## First person renders through the orbit camera, not a second path
Walk mode does not have its own projection: `walkOrbit()` expresses a WalkCamera as an OrbitCamera with `distance: 0`, `target: eye`, `azimuth: yaw + π`, `elevation: -pitch`, so `cameraBasis()` puts the eye exactly at the walk position looking along yaw/pitch. Keep it that way — the near-plane clip in `draw3d` is what makes standing inside the model safe. Tour playback is pure maths in `tourPose()`/`tourLength()` (testable); the rAF loops in drawing-canvas.tsx must depend only on stable setters (`setWalk`, `setTourPlaying`), never the whole `editor` object, or every frame restarts the effect and the tour never advances.

## Openings carry an optional instance size that overrides their type
`DoorElement`/`WindowElement` have optional `width`, `height` (and `sillHeight` on windows). Absent means follow the door/window type — that is the normal case, so never write these fields on placement.

`openingSize()` resolves the override; `openingTypeSize()` gives the type's own size; `openingIsResized()` says whether they differ. Anything that needs the real size must go through `openingSize()`, never `doorTypeOf(...).width`.

Resizing goes through `resizeOpening(opening, currentWidth, wallLength, requestedWidth, anchor)`, which clamps to `MIN_OPENING_WIDTH`/`maxOpeningWidth(wallLength)` and re-clamps `t` — widening without moving `t` pushes a jamb off the end of the host wall. `anchor` of 'a'/'b' holds that jamb still (used by the `openingJamb` grips); 'center' grows evenly (used by the width temporary dimension and the palette).

Changing `typeId` in the properties palette clears all three overrides on purpose: picking a type means taking its size.

## Warnings never block, purge never empties, pins guard four gates
`checkup.ts` is Review Warnings + Purge Unused. Warnings are advisory only — nothing in Axon refuses to draw because of one; keep it that way. `purgeUnusedTypes` always keeps index 0 of each catalogue because the editor reads `wallTypes[0]` on mount.

`pinned` on BaseElement is enforced at four gates and nowhere else: `translateElements`/`rotateElements`/`mirrorElements` in model.ts, `applyGrip`+`gripsFor`+`temporaryDimensionsFor` in manipulators.ts, and `deleteSelection` in use-cad-editor (pinned survive a delete). `copyElements` strips `pinned` from copies but keeps `mark` — that is deliberate: copied marks are how the duplicate-mark warning fires, exactly like Revit. A new transform path must check `element.pinned` itself.

## Library items are ImportedMesh payloads; only designed items keep parts
A library item's payload is exactly the `ImportedMesh` shape `insertMesh()` places (vertices/footprint/size/triangleCount, mm, base at z0, plan-centred via `normalise()`), so placing from the shelf is the import path with parsing done. `kind: 'designed'` items also store their `parts` list — that is the ONLY thing that makes them reopenable in the designer; imported files have no parts and `library.designer?item=` 404s them.

Listing endpoints (`library.index` page prop, `library.feed`) never include the payload — geometry travels only through `library/{item}/payload` at the moment of placing or editing. Keep it that way; a shelf of items can be megabytes.

Thumbnails are pure SVG data URLs from `itemSnapshot()` (fixed camera, back-face culled, ≤1500 faces) — deterministic and testable without a browser, and validated server-side as `starts_with:data:image/svg+xml`. `LibraryItem::MAX_TRIANGLES` (PHP) must stay equal to `MAX_TRIANGLES` in mesh-import.ts (20,000): the mesh ends up inside a project document.

## Clean Up Model repairs slips, never designs, and must stay idempotent
`cleanUpDocument()` fixes what checkup.ts reports: welds corners within `WELD_TOLERANCE` (25mm), squares walls whose axis slip is ≤25mm (a 30° wall is a design decision — the `dx > dy * 4` dominance test is what protects it), removes slivers/duplicates/orphans, refits openings, strips degenerate mesh triangles. Pinned elements are never touched — this is a transform path under the four-gates rule.

Two hard-won invariants: (1) weld targets prefer a pinned member, then the x of a plumb wall and the y of a level wall, then centroid — centroid-only welding re-tilts a just-squared wall and the pipeline oscillates forever; (2) the pipeline iterates internally to a fixpoint (max 8 passes) and reports counts from the first pass only, which is what makes `cleanUpDocument(cleanUpDocument(d))` a no-op — there is a test asserting exactly that, keep it passing.

The Warnings dialog's "Clean up automatically" button just runs the `cleanUpModel` command (shortcut CX); the warnings list re-derives from the document memo, so it re-checks itself.
