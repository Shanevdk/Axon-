---
paths:
  - 'resources/js/components/app-logo*.tsx'
  - resources/js/components/site-picker.tsx
---

# Components

## The product is Vanhaven Design Software
The software is named **Vanhaven Design Software**, shown as `VANHAVEN` over a `Design Software` eyebrow in `app-logo.tsx` and set once as `APP_NAME`. It was briefly called Axon; that name is gone from the UI, so do not reintroduce it in prose. `https://vanhaven.ca` on the landing page is the studio's own site.

The mark is an isometric cube: three faces in three weights of `currentColor` (1 / 0.55 / 0.28) in `app-logo-icon.tsx`. `public/favicon.svg` is the same geometry with the palette hard-coded on ink; `favicon.ico` and `apple-touch-icon.png` are rasterised from it, so regenerate them if the mark changes.

**The name changed; the identifiers deliberately did not.** `axon`/`ax`/`AX` survive wherever renaming would strip somebody of their work or break a file already written: the IndexedDB database is still `axon` (rename it and every locally-held drawing is orphaned — see the vault rule), drawings are still `.axon.json`, type libraries still carry `kind: 'axon.types'`, the MCP server is still registered as `axon-cad`, the admin command is still `axon:admin`, join codes are still `AX-XXXX-XXXX`, DXF layers are still `AX-WALL-EXTERIOR`, and the CSS utilities are still `.ax-eyebrow` and `.ax-rule`. `isTypeLibrary()` accepts `vanhaven.types` too, from the naming before that. None of these are visible to anyone using the software; all of them are load-bearing. Leave them.</note>
</invoke>

## The site picker draws its own map — no map library
Address search plus a pin on a map, used by the new project dialog, Project Information, and (as a starting point) the ground levels dialog. `projects.latitude` / `longitude` hold the pin; `document.site` is separate and is the centre of a MEASURED square of ground, which is not always where the house goes.

There is no Leaflet or MapLibre. `resources/js/lib/map.ts` is the whole map: Web Mercator project/unproject, `tileGrid` for the raster tiles covering a viewport, `panBy` and `pointAt`. It is unit tested — change the projection there, not in the component. Tiles are `<img>` keyed by `z/x/y` so panning reuses loaded images.

The tile URL and its attribution are shared from `HandleInertiaRequests` (`services.places.tiles` / `.attribution`) because the licence on borrowed tiles must be shown beside them and the server is a deployment choice.

`FindPlaces` calls Nominatim, whose terms require a User-Agent naming the app and at most a request a second: the picker waits 600ms after typing stops, the route is `throttle:30,1`, answers cache for 30 days, and a FAILED lookup is explicitly forgotten so an outage does not poison the key for a month. Latitude and longitude validate `required_with` each other — half a coordinate is not a place.
