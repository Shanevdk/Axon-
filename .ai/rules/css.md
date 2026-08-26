---
paths:
  - resources/css/app.css
---

# Css

## Colour is a swappable palette, never a literal
A theme is two colours and their tints: `--accent-tone` (quiet marks) and `--cta-tone` (loud ones), plus `--ink*`, `--paper*`, `--edge`, `--hush`. Four palettes live under `[data-palette='graphite'|'blueprint'|'sand'|'mono']`, graphite being the default. `@theme` maps `--color-sand` → `var(--accent-tone)` and `--color-ember` → `var(--cta-tone)`, so existing `text-sand` / `bg-ember` utilities keep working and re-colour at runtime. The whole shadcn surface in `:root` and `.dark` is derived from these — add no new literal hex there.

The choice is stored in localStorage and a `palette` cookie; `HandleAppearance` whitelists the cookie and shares it, and `app.blade.php` writes `data-palette` on `<html>` so nothing flashes. Never interpolate that cookie without the whitelist.

`resources/js/lib/cad/theme.ts` is deliberately excluded: the drawing canvas keeps its own drafting palette, the way Revit does, regardless of what the chrome is wearing. SVG in pages should use `var(--ink)` etc. so it follows the theme and inverts in dark mode.
