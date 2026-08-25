---
paths:
  - 'resources/js/lib/cad/exchange/**'
---

# Exchange

## Exchange formats go through the solid builder
STEP/STL/OBJ exporters consume `buildSolids()` from `lib/cad/solids.ts` — closed prisms with counter-clockwise-from-outside face windings. The 3D viewport (`mesh.ts`) renders from the same solids, so screen and export cannot drift.

If you add an element kind with volume, add it to `buildSolids()`, not to an exporter. Exporters must stay deterministic: no `Date.now()` — timestamps are passed in as options (STEP defaults to epoch).

Tests are Vitest (`npm test`), colocated as `*.test.ts` next to the library.

## Imported meshes live in the document, capped at 20k triangles
STL/OBJ imports become `mesh` elements storing a flat triangle list (9 numbers per triangle, mm, relative to the insertion point) plus a convex-hull footprint for plan display and picking. `MAX_TRIANGLES = 20_000` in `mesh-import.ts` is a hard cap — the mesh is saved inside the project JSON, so an unbounded scan would make the document unloadable.

`Project::planPreview()` strips `vertices` to `[]` for meshes; only the footprint ships to dashboards. Binary STL is detected by byte-length arithmetic, never by sniffing for "solid".
