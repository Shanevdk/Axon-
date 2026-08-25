---
paths:
  - 'resources/js/components/app-logo*.tsx'
---

# Components

## The product is Axon, everywhere
The software is named **Axon** (after the axonometric). There is no other brand in the UI — the earlier "Van Haven" naming was removed wholesale, so do not reintroduce it. The one deliberate exception is the `https://vanhaven.ca` link on the landing page, which points at the studio's real site.

The mark is an isometric cube: three faces in three weights of `currentColor` (1 / 0.55 / 0.28) in `app-logo-icon.tsx`. `public/favicon.svg` is the same geometry with the palette hard-coded on ink; `favicon.ico` and `apple-touch-icon.png` are rasterised from it, so regenerate them if the mark changes.

Identifiers use `ax`/`AX`: join codes are `AX-XXXX-XXXX`, exported DXF layers are `AX-WALL-EXTERIOR`, the CSS utilities are `.ax-eyebrow` and `.ax-rule`, and exported type libraries carry `kind: 'axon.types'`. `isTypeLibrary()` still accepts the old `vanhaven.types` marker so files exported before the rename keep importing.</note>
</invoke>
