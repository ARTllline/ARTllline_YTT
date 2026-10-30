# Townhouse QA battlemap

`flinns-townhouse.jpg` is the unchanged local reference asset
`Flinns Townhouse [23x27] (DnDavid).jpg`, provided for this project's QA scenario.
The artist's DnDavid credit remains embedded in the image.

- Native size: 1134 × 1331 px; SHA-256:
  `f8d2e0b6c2c15aedf998f9cfa939fb358f7142f2e6ad317d9813f5ce4bf10bb0`.
- Scene: native size, grid 49.3 px, 5 ft per cell, no distortion.
- Runtime: imported through `StoreImage` into the private campaigns disk as a
  campaign Asset. No runtime reads from the external reference folder.
- Explicit local setup/reset: `php artisan qa:townhouse`.
  First installation requires `--install`; see `docs/VERTICAL_SLICE_QA.md`.

This directory is source material for the explicit QA recipe, never an automatic
seed or a public asset route.
