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

## IFC is the Revit link — there is no reading a .rvt
`.rvt` and `.rfa` are closed binary formats with no published specification. Nothing outside Autodesk opens one, and no amount of work in this repo will change that. The import dialog detects them and says to use File → Export → IFC in Revit. Do not add a "Revit importer"; if someone asks, the answer is IFC (or Autodesk Platform Services, which is a paid cloud API and a different project).

`spf.ts` parses the STEP physical file grammar IFC is written in — entities by `#id`, refs, quoted strings with `''` escapes, `.ENUM.`, `$`, inline typed measures. It knows nothing about IFC and is worth reusing for any STEP-family format.

`ifc.ts` maps both ways. IN: walls, slabs, columns and spaces become native elements from IfcExtrudedAreaSolid, and anything else with geometry becomes a mesh so nothing is silently lost. `lengthScale()` MUST prefer IfcConversionBasedUnit over IfcSiUnit — an imperial file carries both, and taking the metre scales the building by 3.28. There is a test. OUT: faceted B-rep classified by solid category, so a wall opens in Revit as IFCWALL. GUIDs come from a counter, not a clock, so the same model exports byte-identically and a diff shows what changed in the building.

Export formats live in `EXPORT_FORMATS`; the dialog reads it, so adding one needs no UI change. A test builds every entry and checks its extension, which catches a format registered but not wired into `buildExport`.
