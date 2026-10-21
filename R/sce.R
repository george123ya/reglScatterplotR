## ----------------------------------------------------------------------------
## SingleCellExperiment / SpatialExperiment integration
## ----------------------------------------------------------------------------
##
## `reglScatterplot()` detects these classes and routes through
## `.inputFromSCE()`, which pulls coordinates from `reducedDim()` (or
## `spatialCoords()` for a SpatialExperiment), and resolves `colorBy` against
## `colData` columns or feature rownames.
##
## SingleCellExperiment and SummarizedExperiment are core dependencies
## (Imports). SpatialExperiment stays in Suggests: a SpatialExperiment object
## cannot exist unless that package is installed and loaded, so its
## accessor is always available when this path runs.


## Internal: extract a 2D coordinate matrix from an SCE or SpatialExperiment.
.coordsFromSCE <- function(sce, dimred) {
    if (identical(dimred, "spatial") &&
        is(sce, "SpatialExperiment")) {
        coords <- SpatialExperiment::spatialCoords(sce)
    } else {
        available <- reducedDimNames(sce)
        if (!length(available)) {
            stop("No reducedDims found in the object. ",
                "Call e.g. scater::runUMAP() first.",
                call. = FALSE
            )
        }
        if (!dimred %in% available) {
            stop(
                sprintf(
                    "reducedDim '%s' not found; available: %s",
                    dimred, paste(available, collapse = ", ")
                ),
                call. = FALSE
            )
        }
        coords <- reducedDim(sce, dimred)
    }
    if (ncol(coords) < 2L) {
        stop(sprintf("'%s' must have at least two columns.", dimred),
            call. = FALSE
        )
    }
    coords
}

## Internal: resolve a `colorBy` argument against an SCE.
##   - colData column name -> the column itself
##   - feature rowname     -> a row of `assay(sce, assay_arg)`
##   - NULL                -> NULL
##   - a raw vector        -> returned unchanged
.colorFromSCE <- function(sce, colorBy, assay_arg) {
    if (is.null(colorBy)) {
        return(NULL)
    }
    if (!(is.character(colorBy) && length(colorBy) == 1L)) {
        return(colorBy)
    }
    cd <- colData(sce)
    if (colorBy %in% colnames(cd)) {
        return(cd[[colorBy]])
    }
    rn <- rownames(sce)
    if (!is.null(rn) && colorBy %in% rn) {
        assay_name <- assay_arg %||% "logcounts"
        available_assays <- assayNames(sce)
        if (!assay_name %in% available_assays) {
            ## Fall back to first available assay
            assay_name <- available_assays[1L]
        }
        return(as.numeric(assay(sce, assay_name)[colorBy, ]))
    }
    stop(sprintf(
        "'%s' is neither a colData column nor a row of the object.",
        colorBy
    ), call. = FALSE)
}

## Internal: adapter called by `.resolveInput()` for SingleCellExperiment and
## SpatialExperiment inputs.
.inputFromSCE <- function(sce, dimred = "UMAP", colorBy = NULL,
                          groupBy = NULL, assay = NULL, xlab = NULL,
                          ylab = NULL, legendTitle = NULL) {
    coords <- .coordsFromSCE(sce, dimred)
    .objectInput(coords,
        color_vec = .colorFromSCE(sce, colorBy, assay),
        group_vec = .colorFromSCE(sce, groupBy, assay),
        colorBy = colorBy,
        xlab = xlab %||% paste0(dimred, " 1"),
        ylab = ylab %||% paste0(dimred, " 2"),
        legendTitle = legendTitle
    )
}
