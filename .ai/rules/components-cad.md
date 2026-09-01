---
paths:
  - resources/js/components/cad/drawing-canvas.tsx
---

# Components Cad

## A press in the 3D view is an orbit until it turns out to be a click
Pointer-down in a model view always starts an orbit/orbitPan/look drag, because there is no telling yet whether the hand means to turn the model or pick something in it. Pointer-up tells them apart by travel: under `CLICK_SLOP` (4px) it is a pick, otherwise it was a turn.

This is exactly what was broken before — the selection branch sat AFTER the generic `if (drag) { setDrag(null); return; }`, so it was unreachable dead code and 3D picking never worked despite hover highlighting fine. Any new drag kind added to the model view must be handled in that same travel check or it will silently kill picking again.

`resolvePick()` in render-3d.ts owns what a click means (plain replaces, Ctrl adds, Shift removes, a miss clears only when unmodified) so it is pure and tested; the component just supplies the modifiers. Picking reads `draw3d`'s returned targets, which are sorted nearest-first and exclude the ground plane — so the surface drawn on top is the one selected, and clicking the ground clears.
