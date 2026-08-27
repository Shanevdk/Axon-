---
paths:
  - 'app/Actions/Library/**'
---

# Library

## The item compiler exists twice, and the two must not drift
`CompileItemParts`/`DrawItemSnapshot` (PHP) are line-for-line twins of `compileParts()`/`itemSnapshot()` in `resources/js/lib/cad/library.ts`. The browser compiles for the designer page; PHP compiles for the MCP `design-library-item` tool. Same primitives (box, cylinder at 12 segments, sketch via ear clipping), same windings, same normalisation (plan centred, base at z0), same snapshot camera. Change one, change the other — `LibraryDesignTest.php` asserts the same numbers the Vitest suite does (box=12 triangles, cylinder=48, square sketch=12), which is what catches drift.

Sketch parts carry `points` (closed outline, mm, centred on the part; width/depth always equal the outline extents — `resizePart()` rescales points, `newSketchPart()`/the tool's normaliser centre them). MCP items are owned by the first user; imported items refuse revision because they have no parts.
