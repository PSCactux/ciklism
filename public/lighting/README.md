# Baked lighting

Shadow and contact-occlusion maps generated locally for the six routes and the
three times of day. The crown silhouettes come from `textures/pine-tree.webp`
and `textures/valley-trees.webp`; the recipe is project code.

`manifest.json` records route, time of day, size and world extent of each map.
File names include a fingerprint of the route and of the shared lighting recipe,
and the unit tests fail if a map is missing or stale. When the baker recipe or
tree placement changes, bump `version` in `lightingKey`.

To regenerate (Node 22.12+): start `npm run dev`, then run `npm run bake:lighting`.
It needs Playwright's Chromium or `CIKLISM_CHROME_PATH`. The baker replaces the
manifest once every route is done and only removes files the old manifest listed.

Only the current route/time map is resident on the GPU: at most 2048² RGBA plus
mipmaps (about 21 MiB). These are approximate projected crown shadows with
penumbra and contact occlusion, not multi-bounce global illumination.
