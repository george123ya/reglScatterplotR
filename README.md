# reglScatterplotR

<!-- badges: start -->
[![R-CMD-check](https://github.com/george123ya/reglScatterplotR/actions/workflows/R-CMD-check.yaml/badge.svg)](https://github.com/george123ya/reglScatterplotR/actions/workflows/R-CMD-check.yaml)
[![Lifecycle: experimental](https://img.shields.io/badge/lifecycle-experimental-orange.svg)](https://lifecycle.r-lib.org/articles/stages.html#experimental)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![BioC status](https://bioconductor.org/shields/build/devel/bioc/reglScatterplotR.svg)](https://bioconductor.org/checkResults/devel/bioc-LATEST/reglScatterplotR/)
[![Codecov test coverage](https://codecov.io/gh/george123ya/reglScatterplotR/branch/main/graph/badge.svg)](https://app.codecov.io/gh/george123ya/reglScatterplotR)
<!-- badges: end -->

`reglScatterplotR` is an `htmlwidgets` interface to the JavaScript
[regl-scatterplot](https://github.com/flekschas/regl-scatterplot) library,
rendering **millions of two-dimensional points** in the browser via WebGL.
Built for exploratory visualisation of single-cell, spatial transcriptomics
and other high-dimensional biological data.

## Features

- WebGL-accelerated point rendering — 5M points smoothly, 10M+ usable.
- Categorical and continuous colour mapping with `RColorBrewer` /
  `viridisLite` palettes.
- Draggable legend with click-to-filter, shift / ctrl / cmd extending.
- Lasso selection and synchronised pan/zoom across multiple widgets.
- PNG / SVG / PDF export.
- Shiny output / render bindings + custom-message handlers for live updates.
- Native `SingleCellExperiment` / `SpatialExperiment` dispatch.
- Works in the RStudio Viewer, Shiny apps, standalone HTML and Jupyter
  notebooks running `IRkernel`.

## Installation

```r
# From GitHub (development version)
remotes::install_github("george123ya/reglScatterplotR")

# Once accepted into Bioconductor
if (!requireNamespace("BiocManager", quietly = TRUE))
    install.packages("BiocManager")
BiocManager::install("reglScatterplotR")
```

## Quick start

```r
library(reglScatterplotR)

# Plain data.frame
set.seed(1L)
df <- data.frame(
    x       = rnorm(20000),
    y       = rnorm(20000),
    cluster = sample(letters[1:6], 20000, replace = TRUE),
    score   = runif(20000)
)
reglScatterplot(df, x = "x", y = "y", colorBy = "cluster")
reglScatterplot(df, x = "x", y = "y", colorBy = "score",
                continuousPalette = "magma",
                vmin = "p1", vmax = "p99")
```

### SingleCellExperiment one-liner

```r
library(SingleCellExperiment)
# sce already has reducedDim(sce, "UMAP") + colData(sce)$cluster
reglScatterplot(sce, x = "UMAP", colorBy = "cluster")

# Or colour by a gene
reglScatterplot(sce, x = "UMAP", colorBy = "MS4A1")
```

### SpatialExperiment tissue map

```r
library(SpatialExperiment)
reglScatterplot(spe, x = "spatial", colorBy = "celltype",
                autoFit = TRUE)
```

## Documentation

| Topic                              | Where                                                |
|------------------------------------|------------------------------------------------------|
| Tour with examples                 | `vignette("reglScatterplot")`                        |
| Scaling to millions of points      | `vignette("performance")`                            |
| Wiki: extended recipes             | <https://github.com/george123ya/reglScatterplotR/wiki>|
| Issue tracker                      | <https://github.com/george123ya/reglScatterplotR/issues>|

## Performance at a glance

| Point count   | Status          | HTML size (typical) |
|---------------|-----------------|---------------------|
| ≤ 500 k       | Flawless        | < 5 MB              |
| 500 k – 5 M   | Smooth          | 10 – 40 MB          |
| 5 M – 20 M    | Usable          | 50 – 100 MB         |
| > 20 M        | Tile architecture territory | — |

The widget uses Uint16-quantised binary transfer, so a 1 M-point single-cell
UMAP normally fits in a < 10 MB HTML file that you can email or commit.

## Citation

```r
citation("reglScatterplotR")
```

Please also cite the underlying JavaScript library: Lekschas, F. (2023).
*regl-scatterplot: A WebGL-Powered Scatter Plot Renderer.*
<https://github.com/flekschas/regl-scatterplot>

## Licence

MIT. See [`LICENSE`](LICENSE).
