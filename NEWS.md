# reglScatterplot 0.99.0

* First Bioconductor submission.
* Package restructured into one file per responsibility (`utils.R`,
  `colors.R`, `scatterplot.R`, `sce.R`, `shiny.R`).
* Functions renamed to Bioconductor camelCase style:
  `my_scatterplot()` → `reglScatterplot()`,
  `my_scatterplotOutput()` / `renderMy_scatterplot()` →
  `reglScatterplotOutput()` / `renderReglScatterplot()`,
  `enableMyScatterplotSync()` → `enableReglScatterplotSync()`,
  `updateMyScatterplotSize()` → `updateReglPointSize()`,
  `to_base64()` → `toBase64()`.
  Argument naming has been harmonised to camelCase
  (`group_var` → `groupBy`, `filter_vars` → `filterBy`,
  `size` → `pointSize`, `gene_names` → `pointLabels`,
  `center_zero` → `centerZero`, `filtered_indices` → `filteredIndices`,
  `selected_indices` → `selectedIndices`, `legend_title` → `legendTitle`).
* `library()` calls inside package code removed; explicit `importFrom`
  declarations added throughout.
* Input validation added: coordinates, palettes, and filter arguments now
  fail fast with informative messages.
* JavaScript widget bugs fixed:
  * empty `ResizeObserver` body now drives the public `resize()` so
    standalone HTML, RStudio Viewer and Jupyter outputs reflow correctly,
  * stale factory `width` / `height` references replaced with live
    `container.getBoundingClientRect()` measurements,
  * the previously undeclared `prevNumPoints` is now properly scoped,
  * CDN imports for `d3` and `regl-scatterplot` are wrapped in
    `try / catch` and display a user-visible error when offline.
* `sizingPolicy()` configured for the RStudio Viewer and Jupyter so
  rendering is correct outside Shiny.
* Tests added under `tests/testthat/` covering utilities, colour
  resolution and widget construction.
* Vignette `reglScatterplot.Rmd` added, including a
  `SingleCellExperiment` walk-through.
* `DESCRIPTION` updated for Bioconductor (biocViews, R >= 4.4.0,
  `URL`/`BugReports`, `VignetteBuilder`, `Suggests` for testing).
* Auto-fit on resize: when the user has not yet panned/zoomed, container
  resize events re-run the data-aspect-preserving fit, eliminating the
  "bottom rows clipped" problem in Hyprland tiles, RStudio Viewer at
  non-default browser zoom, and flex/grid layouts that settle late.
* Single-cell support: `reglScatterplot(sce, x = "UMAP", colorBy = ...)`
  pulls coordinates from `reducedDim()` and resolves `colorBy` against
  `colData` columns or feature rownames automatically. `SpatialExperiment`
  inputs use `spatialCoords()` when `x = "spatial"`.
* Z-channel quantisation (Uint16) cuts the standalone-HTML payload by
  another ~25% on top of the X/Y quantisation already in place. At 5M
  points the file drops from ~78 MB to ~39 MB.
* New `rangePadding` argument (default `0.4`) controls how much
  whitespace is added on each side of the data range. This is the
  recommended dial when clusters appear clipped at the edges of very
  small viewports - the previous fixed margin was not enough at narrow
  window sizes.
* **Known viewport behaviour:** the widget renders inside its
  `htmlwidgets` container, which honours an explicit `height = N`
  pixel value verbatim. If the host window is shorter than `N` (e.g. a
  small browser tab, a tile in a tiling window manager), the bottom of
  the widget is clipped by the host viewport - not by `reglScatterplot`.
  Pass `height = "100%"` (or leave the argument out) to let the widget
  fill whatever vertical space is available.
