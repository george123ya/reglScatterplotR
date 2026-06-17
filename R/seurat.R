## ----------------------------------------------------------------------------
## Seurat integration
## ----------------------------------------------------------------------------
##
## The main `reglScatterplot()` constructor detects `Seurat` objects and routes
## through `.reglScatterplotFromSeurat()`, which pulls coordinates from a
## dimensional reduction (`Embeddings()`) and resolves `colorBy` / `groupBy`
## against `meta.data` columns or feature expression via `FetchData()`.
##
## Only `SeuratObject` is needed (it is the lightweight class/accessor package
## that full `Seurat` re-exports), and it lives in `Suggests:` - the helper
## errors with a clear message if invoked without it. Works with both Seurat
## v4 (`slot`) and v5 (`layer`) objects.


## Internal: pick a sensible reduction name, case-insensitively.
.resolveSeuratReduction <- function(object, dimred) {
    available <- SeuratObject::Reductions(object)
    if (!length(available)) {
        stop("No dimensional reductions found in the Seurat object. ",
            "Run e.g. Seurat::RunUMAP() first.",
            call. = FALSE
        )
    }
    ## When the user left the default "UMAP", auto-pick the most useful
    ## reduction present rather than forcing an exact-case match.
    if (identical(dimred, "UMAP")) {
        for (pref in c("umap", "tsne", "pca")) {
            hit <- available[tolower(available) == pref]
            if (length(hit)) {
                return(hit[1L])
            }
        }
        return(available[1L])
    }
    hit <- available[tolower(available) == tolower(dimred)]
    if (!length(hit)) {
        stop(
            sprintf(
                "Reduction '%s' not found; available: %s",
                dimred, paste(available, collapse = ", ")
            ),
            call. = FALSE
        )
    }
    hit[1L]
}

## Internal: FetchData wrapper that works across Seurat v4 (slot=) and
## v5 (layer=). `vars` may name meta.data columns and/or features.
.fetchSeurat <- function(object, vars, layer, assay) {
    args <- list(object = object, vars = vars)
    if (!is.null(assay)) args$assay <- assay
    out <- tryCatch(
        do.call(SeuratObject::FetchData, c(args, list(layer = layer))),
        error = function(e) {
            ## Older SeuratObject uses `slot` rather than `layer`.
            tryCatch(
                do.call(SeuratObject::FetchData, c(args, list(slot = layer))),
                error = function(e2) {
                    stop(sprintf(
                        paste0(
                            "Could not resolve '%s' in the Seurat object ",
                            "(not a meta.data column or a feature). ",
                            "Original error: %s"
                        ),
                        paste(vars, collapse = ", "), conditionMessage(e2)
                    ), call. = FALSE)
                }
            )
        }
    )
    out
}

## Internal: resolve a single colorBy/groupBy spec against a Seurat object.
.colorFromSeurat <- function(object, spec, layer, assay) {
    if (is.null(spec)) {
        return(NULL)
    }
    if (!(is.character(spec) && length(spec) == 1L)) {
        ## A raw vector was passed through; hand it back untouched.
        return(spec)
    }
    vec <- .fetchSeurat(object, spec, layer, assay)[[1L]]
    vec
}

## Top-level dispatch helper invoked from `reglScatterplot()` when `data` is a
## Seurat object. `assay` is reinterpreted as the Seurat *layer* (the matrix to
## read for feature colouring) - "data" (log-normalised) by default, the
## analogue of `logcounts` for SCE - while the Seurat *assay* (RNA/ADT/...) is
## taken from `DefaultAssay()` unless `seuratAssay` is supplied via `...`.
.reglScatterplotFromSeurat <- function(object,
                                       dimred = "UMAP",
                                       colorBy = NULL,
                                       groupBy = NULL,
                                       assay = NULL,
                                       seuratAssay = NULL,
                                       xlab = NULL,
                                       ylab = NULL,
                                       legendTitle = NULL,
                                       ...) {
    if (!requireNamespace("SeuratObject", quietly = TRUE)) {
        stop("Install 'SeuratObject' (or 'Seurat') to plot Seurat objects.",
            call. = FALSE
        )
    }

    reduction <- .resolveSeuratReduction(object, dimred)
    coords <- SeuratObject::Embeddings(object, reduction = reduction)
    if (ncol(coords) < 2L) {
        stop(sprintf("Reduction '%s' has fewer than two dimensions.",
            reduction
        ), call. = FALSE)
    }

    ## `assay` (SCE-style name) -> Seurat layer; default "data" (lognorm).
    layer <- assay %||% "data"
    color_vec <- .colorFromSeurat(object, colorBy, layer, seuratAssay)
    group_vec <- .colorFromSeurat(object, groupBy, layer, seuratAssay)

    if (is.null(xlab)) xlab <- paste0(toupper(reduction), " 1")
    if (is.null(ylab)) ylab <- paste0(toupper(reduction), " 2")
    if (is.null(legendTitle) &&
        is.character(colorBy) && length(colorBy) == 1L) {
        legendTitle <- colorBy
    }

    df <- data.frame(.x = coords[, 1L], .y = coords[, 2L])
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
