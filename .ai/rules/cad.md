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
  - resources/js/lib/cad/takeoff.ts
  - resources/js/lib/cad/explode.ts
  - resources/js/lib/cad/code.ts
  - resources/js/lib/cad/terrain.ts
  - resources/js/lib/cad/walk.ts
  - resources/js/lib/cad/theme.ts
  - resources/js/lib/cad/views.ts
  - resources/js/lib/cad/grain.ts
---

# Cad

## Vanhaven brand palette and type
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
`checkup.ts` is Review Warnings + Purge Unused. Warnings are advisory only — nothing in Vanhaven refuses to draw because of one; keep it that way. `purgeUnusedTypes` always keeps index 0 of each catalogue because the editor reads `wallTypes[0]` on mount.

`pinned` on BaseElement is enforced at four gates and nowhere else: `translateElements`/`rotateElements`/`mirrorElements` in model.ts, `applyGrip`+`gripsFor`+`temporaryDimensionsFor` in manipulators.ts, and `deleteSelection` in use-cad-editor (pinned survive a delete). `copyElements` strips `pinned` from copies but keeps `mark` — that is deliberate: copied marks are how the duplicate-mark warning fires, exactly like Revit. A new transform path must check `element.pinned` itself.

## Library items are ImportedMesh payloads; only designed items keep parts
A library item's payload is exactly the `ImportedMesh` shape `insertMesh()` places (vertices/footprint/size/triangleCount, mm, base at z0, plan-centred via `normalise()`), so placing from the shelf is the import path with parsing done. `kind: 'designed'` items also store their `parts` list — that is the ONLY thing that makes them reopenable in the designer; imported files have no parts and `library.designer?item=` 404s them.

Listing endpoints (`library.index` page prop, `library.feed`) never include the payload — geometry travels only through `library/{item}/payload` at the moment of placing or editing. Keep it that way; a shelf of items can be megabytes.

Thumbnails are pure SVG data URLs from `itemSnapshot()` (fixed camera, back-face culled, ≤1500 faces) — deterministic and testable without a browser, and validated server-side as `starts_with:data:image/svg+xml`. `LibraryItem::MAX_TRIANGLES` (PHP) must stay equal to `MAX_TRIANGLES` in mesh-import.ts (20,000): the mesh ends up inside a project document.

## Clean Up Model repairs slips, never designs, and must stay idempotent
`cleanUpDocument()` fixes what checkup.ts reports: welds corners within `WELD_TOLERANCE` (25mm), squares walls whose axis slip is ≤25mm (a 30° wall is a design decision — the `dx > dy * 4` dominance test is what protects it), removes slivers/duplicates/orphans, refits openings, strips degenerate mesh triangles. Pinned elements are never touched — this is a transform path under the four-gates rule.

Two hard-won invariants: (1) weld targets prefer a pinned member, then the x of a plumb wall and the y of a level wall, then centroid — centroid-only welding re-tilts a just-squared wall and the pipeline oscillates forever; (2) the pipeline iterates internally to a fixpoint (max 8 passes) and reports counts from the first pass only, which is what makes `cleanUpDocument(cleanUpDocument(d))` a no-op — there is a test asserting exactly that, keep it passing.

The Warnings dialog's "Clean up automatically" button just runs the `cleanUpModel` command (shortcut CX); the warnings list re-derives from the document memo, so it re-checks itself.

## The bill of materials, and how it decides what things are made of
`takeoff.ts` turns the model into things to buy; `constructionOf()` in model.ts decides what each element is made of. Resolution order is element `construction` → wall type `construction` → inference, and the inference reads the TYPE NAME before the thickness on purpose: the starter catalogue ships "Exterior - Brick on Stud" at 302mm, which is a stud wall despite being thicker than most concrete. Never reorder those.

Two traps that cost a rewrite each. (1) Stud depth is capped at `MAX_STUD_DEPTH` (140): a wall type carries one thickness for the whole build-up, so a veneer wall's "core" includes the brick and cavity and would otherwise buy 2x10 studs. (2) A floor is a slab when it is at or UNDER `SLAB_FLOOR_THICKNESS` (150) — thin floors cannot be joisted, thick ones are joists. It reads backwards until you think about it.

Quantities stay in base units (mm/mm²/mm³/count); only `formatQuantity()` knows metres and feet. Waste is a separate `waste` fraction never folded into `quantity` — the sheet shows measured and order side by side so the allowance is visible. Only elements in the new phase are counted. Adding an element kind means a `takeOff*` case plus a `measure()` branch, or it silently costs nothing.

## Exploding reuses the ordinary solids; assemblies must close on their thickness
`explode.ts` is a pure transform of `buildSolids()` output — the renderer never learns about it, so an exploded model draws through the same painter's algorithm. `buildModelFaces(document, explode)` is the only wiring. Two modes: no focus spreads every element out from the model centre and lifts storeys apart; a focus replaces that ONE element with `assemblySolids()` layers spread along the wall normal (or up, for flat things), and drops anything it hosts so a door leaf does not hang in the gap.

`assembly.ts` answers "what is in there" from the same `constructionOf()` the BOM reads, so the exploded parts and the bill can never disagree. Hard invariant: a wall's and a floor's layers must sum EXACTLY to the element's thickness, because they are drawn slices of it — the skins are fixed and the stud cavity absorbs the remainder. Getting this wrong makes the parts fail to reassemble into the wall they came from; there is a test asserting the layer bounds equal the solid's.

## The wall code table is small, Canadian, and advisory on purpose
`code.ts` maps a project's `jurisdiction` string to a minimum effective wall RSI (NBC 2020 9.36.2.6, no-HRV column) and estimates what a wall type achieves. It is deliberately NOT a building code: it knows only above-grade wall thermal resistance, nothing about fire, structure, seismic or zoning, and `requirementFor()` returns null for anywhere outside the Canadian table rather than guessing — keep that, guessing a foreign code is worse than silence. Both the estimate and the table's narrowness must stay visible wherever it is shown, matching the code consultant's posture.

`bringWallsUpToCode()` only deepens walls with a cavity (wood/steel) and returns concrete/masonry in `needsInsulation` instead. Thickening mass walls changes the drawing without changing the answer — the fix is insulation, which is a design decision, not a dimension. It also never thins a wall (`Math.max` on thickness): somebody drew that dimension for a reason the code does not know about. The checkup warning only fires for types actually drawn in, so an unused catalogue entry is not noise.

## Ground reaches every view through groundFaces(), and siting moves the ground
Terrain is a grid of spot heights on `document.site`, not an element: heights are mm above the project datum (model z), and `Site.seaLevel` is the only place metres above sea level appear.

`mesh.ts groundFaces()` is the single seam. 3D, elevation and section views all render from the same face list, so returning a sampled surface there puts real ground in all of them at once — never add a second ground path per view. Ground faces must keep `elementId: ''`, or `boundsOfFaces` stops excluding them and Zoom Fit frames the horizon instead of the building.

Siting the house moves the TERRAIN, not the elements — walls must not shuffle because somebody dragged a pin. On its own that looks like the ground moving, so `drawing-canvas.tsx` pans the camera by the same delta; the two cancel and the house appears to travel. Both are computed from the drag's starting origin and centre, never incrementally, or the pan feeds back into itself.

The row-major order (west→east, then south→north from the south-west sample) is a contract between `FetchGroundLevels` in PHP and `Terrain` here. Break it and the ground comes out mirrored with nothing to say so; there is a test on each side.

`heightAt()` clamps outside the survey rather than returning null, deliberately: an elevation should show ground running away level, not a cliff where the data stopped. Ask `coversPoint()` when the difference matters.

## The client portal walks a published model, not the thumbnail preview
`buildPreview` keeps ONE level, so it cannot serve a walkthrough. `buildClientModel` (preview.ts) keeps every level and is published to `projects.client_model` by the editor's `publish()`, alongside the preview and the summary. `Project::houseModel()` prefers it and falls back to `document`; `houseModelIsWholeBuilding()` is false when only the one-level preview exists and the portal says so on screen.

`buildClientModel` is stated as a DROP list (`NOT_BUILT`), not a keep list, so a new element kind reaches clients by default. Meshes are dropped on size — one import can carry tens of thousands of vertices.

Collision lives in `walk.ts`, not in the page. `slideAlongWalls` only knows whether a point is inside a wall, so `stepWalker` SWEEPS the move in sub-steps shorter than the thinnest clearance — take that out and one slow frame puts the client through a wall and into the garden. Doorways are arc-length gaps cut from the barrier; windows are deliberately not gaps. There is a test for the tunnelling case.

The editor's own walk mode is separate and stays uncollided — a designer wants to walk through a wall to see a junction.

## Material is a property of a surface; colour needs a style that fills
`Material` (types.ts) is NOT `Construction`. Construction is what an element is framed in; Material is what one surface is — a framed wall is `wood` construction but its faces are cladding, sheathing, studs, batt and gypsum. So `Face.material` is per-face: an assembly layer sets `Solid.material` explicitly, and `materialFor()` in mesh.ts infers it from category + construction otherwise. Two palettes: `MODEL_MATERIALS` (the studio's drawing tints, always) and `NATURAL_MATERIALS` + `MATERIAL_GRAIN` (real colours with wood grain and masonry courses, under the `naturalMaterials` view setting).

The trap that shipped broken once: the 3D view DEFAULTS to `hiddenLine`, which paints every face `CAD_THEME.paper` white, and wireframe fills nothing — so turning natural materials on there changed a setting and nothing visible. `withNaturalMaterials()` in views.ts is the fix and the single home for that rule: switching on from a non-filling style also moves the view to `shaded`. Any new control that depends on fill colour must go through it or it will appear broken in the default view.

## View defaults differ by kind — 3D opens shaded, sheets open hidden line
`DEFAULT_VIEW_SETTINGS` is hidden line, which is right for anything printed on a sheet (plan, ceiling, elevation, section) — white paper, black ink. It is wrong for the 3D and Site views: hidden line fills every face with paper, so the model opens as a white building on white ground and reads as a broken screen, not as a drawing convention.

`defaultSettingsFor(kind)` is where that split lives; `settingsFor(document, view)` takes the CadView, not an id, because an id alone cannot tell you the kind. Add a new view kind and decide there whether it is a sheet or a model.

Stored `viewSettings` are SPARSE — `setViewSetting` only writes the keys a user actually changed — so changing a default reaches existing documents rather than being masked by them. Do not start writing whole merged settings objects back into the document or that stops being true.

The client portal's tour (`pages/portal/tour.tsx`) passes its own `visualStyle: 'realistic'` and does not read view settings at all.

## Grain and coursing are model geometry, not a screen effect
`grainLines(face, material)` works out a surface's marks in the plane of the face, in MILLIMETRES, and returns them as 3D segments. `draw3d` only projects them. Never lay marks over the projected outline at a spacing in pixels — that is what made grain swim across a wall as the model turned and flip between horizontal and vertical as a face passed through square on.

Direction follows the material, not the screen: timber runs along the face's longest edge (how a member is sawn), masonry runs level (`cross(up, normal)`, falling back to the longest edge on a flat face). Spacings are real — `WOOD_SPACING` 55, `COURSE_HEIGHT` 86, `BRICK_LENGTH` 215.

Lines are placed at absolute multiples of the spacing measured from the face origin, and strictly INSIDE the bounds. On the boundary a line just redraws the face outline; counted from the face's own minimum instead of from zero, neighbouring faces of one wall would disagree about where the marks fall.

The legibility guard in render-3d measures the WIDEST gap between projected lines, not the narrowest. A wall running away from the camera converges at its far end, and that is perspective working — judging the face by its far end strips the grain off the near end too.

`render-grain.test.ts` renders through a stub 2D context; it guards that grain is still drawn at all, and that it slants with an obliquely-viewed wall (the old screen-space version always came out flat).

## The bill of materials covers whole trades, and says which ones are allowances
Twelve sections, matching the trades on site: concrete, framing, roofing, envelope, openings, insulation, electrical, plumbing, hvac, finishes, hardware, site. `SECTION_ORDER` is the print order — the schedule view iterates it, so adding a section needs no UI change.

Three passes, in this order, and the order matters:
1. Per element, from `measure()`.
2. `takeOffServices()` — panel, breakers, sockets, cable, water heater, furnace, registers. Worked out from FLOOR AREA and ROOM COUNT at the ratios near the top of the file, because nothing in the model says where a socket goes. These are ALLOWANCES; the schedule view says so on the sheet, and `ALLOWANCE_SECTIONS` in schedule-view.tsx is the list. Draw real services and their elements are measured on top.
3. `takeOffConsumables()` — screws follow board, nails follow sheathing, paint follows what it is painted on. Reads the finished list rather than each element, keyed off the `NAMED` constants. If you rename a material, rename it there; matching on free strings is what that object exists to prevent.

An opening looks up its host wall to know whether it is an exterior door (3 hinges, deadbolt, weatherstripping, threshold) or an interior one. `isLowestLevel()` decides sill plate and anchor bolts versus a ledger board, by ELEVATION not by level order.

`ridgeRun()` solves the rectangle with the roof's area and perimeter; a square plan correctly returns zero, because that is a pyramid.
