## ----------------------------------------------------------------------------
## AnnData integration (in-memory R6 objects)
## ----------------------------------------------------------------------------
##
## Covers the two common ways an AnnData lands in R as a live object:
##   * the `anndata` CRAN package  -> class "AnnDataR6"
##   * the `anndataR` Bioc package -> R6 classes inheriting "AbstractAnnData"
##
## Both expose the same field interface (`$obsm`, `$obs`, `$X`, `$var_names`,
## `$layers`, and optionally `$raw`), so one code path serves both. Users who
## instead read with `zellkonverter::readH5AD()` get a SingleCellExperiment and
## go through the SCE dispatch, so nothing extra is needed there.
##
## The resolution rules mirror the Python package (`reglscatterpy`):
##   * `x` selects an `obsm` embedding; "umap" is auto-prefixed to the
##     scanpy-style "X_umap" and matched case-insensitively, falling back to
##     the first of umap / tsne / pca / spatial present.
##   * `colorBy` / `groupBy` resolve against `obs` columns first, then against
##     `var_names` (a feature), reading `X` - or the `assay` layer, or "raw".


## Internal: is `x` an in-memory R6 AnnData we know how to read?
.isAnnDataR6 <- function(x) {
    if (inherits(x, c("AnnDataR6", "AbstractAnnData"))) {
        return(TRUE)
    }
    ## Duck-type fallback: an R6 object carrying the AnnData field interface.
    inherits(x, "R6") &&
        all(c("obsm", "obs", "X", "var_names") %in% names(x))
}

## Internal: resolve a user `x`/dimred to a concrete obsm key.
.annResolveBasis <- function(ad, dimred) {
    keys <- names(ad$obsm)
    if (!length(keys)) {
        stop("No embeddings found in .obsm; run e.g. UMAP first.",
            call. = FALSE
        )
    }
    lower <- stats::setNames(keys, tolower(keys))

    if (identical(dimred, "UMAP")) {
        for (pref in c("x_umap", "x_tsne", "x_pca", "spatial")) {
            if (pref %in% names(lower)) {
                return(unname(lower[[pref]]))
            }
        }
        return(keys[1L])
    }
    for (cand in c(dimred, paste0("X_", dimred))) {
        if (cand %in% keys) {
            return(cand)
        }
        if (tolower(cand) %in% names(lower)) {
            return(unname(lower[[tolower(cand)]]))
        }
    }
    stop(sprintf(
        "Embedding '%s' not found in .obsm; available: %s",
        dimred, paste(keys, collapse = ", ")
    ), call. = FALSE)
}

## Internal: resolve a colorBy/groupBy spec against an AnnData.
.annResolveVec <- function(ad, spec, layer) {
    if (is.null(spec)) {
        return(NULL)
    }
    if (!(is.character(spec) && length(spec) == 1L)) {
        return(spec) # raw vector passed through
    }

    obs <- ad$obs
    if (spec %in% colnames(obs)) {
        return(obs[[spec]])
    }

    use_raw <- identical(layer, "raw")
    src <- if (use_raw) ad$raw else ad
    if (is.null(src)) {
        stop("layer = 'raw' requested but .raw is empty.", call. = FALSE)
    }
    vn <- src$var_names
    if (!is.null(vn) && spec %in% vn) {
        idx <- match(spec, vn)
        mat <- if (use_raw) {
            src$X
        } else if (!is.null(layer)) {
            l <- ad$layers[[layer]]
            if (is.null(l)) {
                stop(sprintf("layer '%s' not found.", layer), call. = FALSE)
            }
            l
        } else {
            ad$X
        }
        return(as.numeric(mat[, idx]))
    }
    stop(sprintf(
        "'%s' is neither an .obs column nor a feature in .var_names.", spec
    ), call. = FALSE)
}

## Top-level dispatch helper invoked from `reglScatterplot()` when `data` is an
## in-memory AnnData. `assay` is reinterpreted as the AnnData *layer* to read
## for feature colouring (NULL -> `.X`, a layer name, or "raw").
.reglScatterplotFromAnnData <- function(ad,
                                        dimred = "UMAP",
                                        colorBy = NULL,
                                        groupBy = NULL,
                                        assay = NULL,
                                        xlab = NULL,
                                        ylab = NULL,
                                        legendTitle = NULL,
                                        ...) {
    basis <- .annResolveBasis(ad, dimred)
    coords <- as.matrix(ad$obsm[[basis]])
    if (ncol(coords) < 2L) {
        stop(sprintf("Embedding '%s' has fewer than two columns.", basis),
            call. = FALSE
        )
    }

    color_vec <- .annResolveVec(ad, colorBy, assay)
    group_vec <- .annResolveVec(ad, groupBy, assay)

    label <- sub("^X_", "", basis)
    if (is.null(xlab)) xlab <- paste0(toupper(label), " 1")
    if (is.null(ylab)) ylab <- paste0(toupper(label), " 2")
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
