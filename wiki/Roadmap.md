# Roadmap

## In scope

* **Bundle the JS deps locally** — eliminates the `file://` CORS problem
  and makes the HTML truly self-contained.
* **More `SpatialExperiment` examples** — Visium, CosMx, Xenium-shaped
  data with realistic tissue coordinate handling.
* **Density-aware subsampling** — keep outliers and sparse regions when
  drawing a coarse preview.

## Maybe

* **WebWorker for the filter recalc** — at 10 M, the categorical-filter
  loop blocks the main thread for ~100 ms.
* **Aspect-preserving auto-fit that doesn't trigger edge clipping** —
  the missing third option between `autoFit = TRUE` (stretch) and the
  current default (fill normalised space).
* **Linked plots without Shiny** — a small helper that wires sync
  between plots inside a static HTML doc.

## Out of scope

* **Tile architecture** — that's deepscatter territory. We point users
  at it when they need > 20 M points routinely.
* **3D scatter** — not what `regl-scatterplot` is for. Use `plotly` or
  `rgl` for 3D.
* **Statistical overlays** (regression lines, confidence bands) —
  composable with `ggplotly`, not our problem.

## Open questions

* Are S4 methods worth it (vs. the current class-based dispatch
  inside the main constructor)? Bioconductor reviewers tend to prefer
  S4 but it adds boilerplate.
* Should the package support multiple coordinate layers
  (e.g. UMAP + spatial side by side via syncing)?
* Quarto integration — currently works because Quarto handles
  `htmlwidgets` natively, but a vignette example would help users.

Contributions on any of these welcome via PRs or issues.
