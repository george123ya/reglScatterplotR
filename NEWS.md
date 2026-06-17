# reglScatterplot 0.99.1

* **Bundled example dataset.** `data(reglScatterExample)` loads a small
  (3,400-cell) synthetic single-cell-style UMAP `data.frame` with a
  categorical cell-type column and a continuous marker gradient, so users
  can plot something immediately without downloading data or installing a
  Suggests package. Used by the examples, vignette and tests.
* **Seurat support.** `reglScatterplot()` now dispatches on `Seurat`
  objects: coordinates come from `Embeddings()` (reduction matched
  case-insensitively, default `"UMAP"` with `umap`/`tsne`/`pca` fallback),
  and `colorBy` / `groupBy` resolve against `meta.data` columns or features
  via `FetchData()`. Works with both Seurat v4 (`slot`) and v5 (`layer`)
  objects. `SeuratObject` added to `Suggests`.
* **Plain matrix input.** `reglScatterplot(m)` accepts a numeric coordinate
  matrix (e.g. a UMAP embedding or `prcomp()$x`), using the first two
  columns by default; `x` / `y` may select other columns by index or name.
* **Monocle3.** A `cell_data_set` is a `SingleCellExperiment` subclass, so it
  flows through the existing SCE dispatch unchanged - now covered by a test
  and documented.
* **AnnData support.** `reglScatterplot()` now dispatches on in-memory
  `AnnData` objects (from `anndataR` or the `anndata` CRAN package):
  coordinates from an `obsm` embedding (default `"UMAP"` -> `"X_umap"`,
  matched case-insensitively), `colorBy` / `groupBy` resolved against `obs`
  columns or `var_names` features, with `assay` selecting the layer
  (`X` / a layer / `"raw"`). AnnData read via `zellkonverter::readH5AD()`
  continues to use the `SingleCellExperiment` path. `anndataR` added to
  `Suggests`.
* **`filterBy` now shows interactive sliders outside Shiny.** A range-filter
  panel (one dual slider per numeric `filterBy` column) is rendered in the
  widget for standalone HTML / R Markdown / the Viewer, so dragging a range
  filters the points live. Previously the slider UI only existed when a Shiny
  app supplied it; the data was loaded but nothing was shown. Tightened the
  legend so its height fits its contents.
* **`title` is now drawn on screen.** Previously the `title` argument only
  appeared in PNG/SVG/PDF exports; it now renders as a centred caption at the
  top of the plot (coloured with `axisColor`).
* **Client-side plot sync without Shiny.** Passing the same `syncPlots` group to
  several plots now links their pan/zoom in plain HTML / R Markdown / the
  Viewer, not just in Shiny. Plots are now keyed by their logical `plotId`
  (previously the internal DOM id won, so a `syncPlots` group never matched and
  sync silently did nothing outside Shiny). Verified with a headless-browser
  test (`js/test-sync.mjs`).
* **Legend theming.** The legend header background now follows `legendBg` (it
  was a fixed light strip that looked wrong on dark themes), and the header
  title text follows `legendText` instead of a CSS variable that RStudio's dark
  Qt theme could override to a near-invisible colour (the "white legend title"
  bug). The legend also has a hard height cap so it can't span the whole plot
  when the container height is indefinite (e.g. a knitted R Markdown).
* **Download button honours an explicit `enableDownload = TRUE`.** The export
  button was hidden inside any iframe (RStudio Viewer, knitted-HTML preview,
  Jupyter); an explicit opt-in now always shows it.
* **Crisp rendering in the RStudio Viewer (`pixelRatio`).** The widget now
  renders the WebGL backing store at `max(devicePixelRatio, 2)` by default
  instead of relying on `window.devicePixelRatio`, which the RStudio Viewer (an
  embedded browser) reports as `1` even on HiDPI screens - the cause of the
  previously soft / low-quality look in the Viewer. A new `pixelRatio` argument
  overrides this (e.g. `pixelRatio = 1` to save GPU memory, `3` for
  export-quality sharpness); very large data (`n > 500000`) keeps the true ratio
  to bound the pixel count.
* **No CDN at runtime - the widget now works offline.** All browser
  dependencies (`regl-scatterplot`, `d3`, `pickr`, `html2canvas`, `jspdf`)
  are bundled into `inst/htmlwidgets/reglScatterplot.js` with esbuild, instead
  of being fetched from esm.sh / cdnjs via dynamic `import()` and `<script>`
  injection. Standalone HTML reports, the RStudio Viewer and firewalled /
  air-gapped environments now render without a network connection. Build
  sources and instructions live in `js/` (excluded from the package build).

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
