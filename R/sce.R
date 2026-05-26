## ----------------------------------------------------------------------------
## SingleCellExperiment / SpatialExperiment integration
## ----------------------------------------------------------------------------
##
## The main `reglScatterplot()` constructor detects these classes and routes
## through `.reglScatterplotFromSCE()`, which pulls coordinates from
## `reducedDim()` (or `spatialCoords()` for SpatialExperiment), and resolves
## `colorBy` against `colData` columns or feature rownames.
##
## Both packages are in `Suggests:` - the helper errors with a clear message
## if invoked without them installed.


## Internal: extract a 2D coordinate matrix from an SCE or SpatialExperiment.
.coordsFromSCE <- function(sce, dimred) {
    if (identical(dimred, "spatial") &&
        inherits(sce, "SpatialExperiment")) {
        if (!requireNamespace("SpatialExperiment", quietly = TRUE)) {
            stop("Install 'SpatialExperiment' to use dimred = 'spatial'.",
                call. = FALSE
            )
        }
        coords <- SpatialExperiment::spatialCoords(sce)
    } else {
        if (!requireNamespace("SingleCellExperiment", quietly = TRUE)) {
            stop("Install 'SingleCellExperiment' to use the SCE method.",
                call. = FALSE
            )
        }
        available <- SingleCellExperiment::reducedDimNames(sce)
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
        coords <- SingleCellExperiment::reducedDim(sce, dimred)
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
##   - feature rowname     -> a row of `assay(sce, assay)`
##   - NULL                -> NULL
.colorFromSCE <- function(sce, colorBy, assay) {
    if (is.null(colorBy)) {
        return(NULL)
    }
    if (!requireNamespace("SummarizedExperiment", quietly = TRUE)) {
        stop("Install 'SummarizedExperiment' to use colorBy with SCE inputs.",
            call. = FALSE
        )
    }
    cd <- SummarizedExperiment::colData(sce)
    if (is.character(colorBy) && length(colorBy) == 1L &&
        colorBy %in% colnames(cd)) {
        return(cd[[colorBy]])
    }
    rn <- rownames(sce)
    if (is.character(colorBy) && length(colorBy) == 1L &&
        !is.null(rn) && colorBy %in% rn) {
        assay_name <- assay %||% "logcounts"
        available_assays <- SummarizedExperiment::assayNames(sce)
        if (!assay_name %in% available_assays) {
            ## Fall back to first available assay
            assay_name <- available_assays[1L]
        }
        return(as.numeric(
            SummarizedExperiment::assay(sce, assay_name)[colorBy, ]
        ))
    }
    stop(sprintf(
        "'%s' is neither a colData column nor a row of the object.",
        colorBy
    ), call. = FALSE)
}

## Top-level dispatch helper invoked from `reglScatterplot()` when `data` is
## a SingleCellExperiment-derived object.
##
## `legendTitle` is named explicitly in the signature so it does NOT slip
## into `...` from the caller and then collide with the default we set
## here (R was failing with "matched by multiple actual arguments").
.reglScatterplotFromSCE <- function(sce,
                                    dimred = "UMAP",
                                    colorBy = NULL,
                                    groupBy = NULL,
                                    assay = NULL,
                                    xlab = NULL,
                                    ylab = NULL,
                                    legendTitle = NULL,
                                    ...) {
    coords <- .coordsFromSCE(sce, dimred)
    df <- data.frame(.x = coords[, 1L], .y = coords[, 2L])

    color_vec <- .colorFromSCE(sce, colorBy, assay)
    group_vec <- .colorFromSCE(sce, groupBy, assay)

    if (is.null(xlab)) xlab <- paste0(dimred, " 1")
    if (is.null(ylab)) ylab <- paste0(dimred, " 2")
    ## Default the legend title to the colorBy name when the user didn't
    ## supply one.
    if (is.null(legendTitle) &&
        is.character(colorBy) && length(colorBy) == 1L) {
        legendTitle <- colorBy
    }

    reglScatterplot(
        data = df,
        x = ".x", y = ".y",
        colorBy = color_vec,
        groupBy = group_vec,
        xlab = xlab, ylab = ylab,
        legendTitle = legendTitle,
        ...
    )
}
