## ----------------------------------------------------------------------------
## Bundled example data
## ----------------------------------------------------------------------------

#' Example single-cell UMAP embedding
#'
#' A small, synthetic single-cell-style dataset for trying out
#' [reglScatterplot()] without downloading anything or installing a
#' Bioconductor data package. It mimics a PBMC UMAP: eight cell-type clusters
#' arranged as Gaussian blobs in two dimensions, plus a handful of continuous
#' covariates and one marker-gene-like gradient.
#'
#' @format A `data.frame` with 3,400 rows (cells) and 7 columns:
#' \describe{
#'   \item{UMAP_1, UMAP_2}{Numeric. Two-dimensional UMAP coordinates.}
#'   \item{celltype}{Factor with 8 levels (`"CD4 T"`, `"CD8 T"`, `"NK"`,
#'     `"B"`, `"Monocyte"`, `"Dendritic"`, `"Platelet"`, `"Progenitor"`).
#'     Use as a categorical `colorBy`.}
#'   \item{nCount}{Integer. Total counts per cell (library size).}
#'   \item{nFeature}{Integer. Number of detected features per cell.}
#'   \item{percentMito}{Numeric. Percent mitochondrial counts (0-25).}
#'   \item{CD3D}{Numeric. Log-normalised expression of a T/NK marker, with
#'     dropout. Use as a continuous `colorBy`.}
#' }
#'
#' @details The data are simulated (see `data-raw/make_reglScatterExample.R`)
#' and carry no biological meaning beyond being shaped like real scRNA-seq
#' output. They exist purely so the examples, vignette and tests have
#' something realistic to draw.
#'
#' @source Simulated. Generation script in `data-raw/`.
#'
#' @examples
#' data(reglScatterExample)
#' # Colour by cell type (categorical)
#' reglScatterplot(reglScatterExample,
#'     x = "UMAP_1", y = "UMAP_2", colorBy = "celltype"
#' )
#' # Colour by a continuous marker gene
#' reglScatterplot(reglScatterExample,
#'     x = "UMAP_1", y = "UMAP_2", colorBy = "CD3D",
#'     continuousPalette = "viridis", vmax = "p99"
#' )
#' @docType data
#' @keywords datasets
#' @name reglScatterExample
"reglScatterExample"
