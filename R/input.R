## ----------------------------------------------------------------------------
## Input resolution for reglScatterplot()
## ----------------------------------------------------------------------------
##
## `.resolveInput()` turns every supported input type into one common shape:
##   list(data, x, y, colorBy, groupBy, xlab, ylab, legendTitle)
## `x` / `y` / `colorBy` / `groupBy` are then either column names of `data`
## or plain vectors, and the rest of reglScatterplot() never needs to know
## which class the user passed in.


## Internal: unwrap a crosstalk::SharedData. An object of that class can only
## exist when crosstalk is installed, so no requireNamespace() is needed.
.unwrapCrosstalk <- function(data) {
    if (!inherits(data, "SharedData")) {
        return(list(data = data, key = NULL, group = NULL))
    }
    list(data = data$origData(), key = data$key(), group = data$groupName())
}

## Internal: the crosstalk part of the widget payload.
.crosstalkSpec <- function(ct) {
    list(
        on = !is.null(ct$group),
        group = ct$group,
        key = if (!is.null(ct$key)) I(as.character(ct$key)) else NULL
    )
}

## Internal: a single column name, or NULL when `spec` is a raw vector.
.varName <- function(spec) {
    if (is.character(spec) && length(spec) == 1L) spec else NULL
}

## Internal: dispatch on the class of `data`.
.resolveInput <- function(data, x, y, colorBy, groupBy, assay,
                          xlab, ylab, legendTitle) {
    plain <- list(
        data = data, x = x, y = y, colorBy = colorBy, groupBy = groupBy,
        xlab = xlab, ylab = ylab, legendTitle = legendTitle
    )
    if (is.null(data)) {
        return(plain)
    }
    if (is.matrix(data) && is.numeric(data)) {
        return(.inputFromMatrix(data, plain))
    }
    adapter <- if (inherits(data, "Seurat")) {
        .inputFromSeurat
    } else if (.isAnnDataR6(data)) {
        .inputFromAnnData
    } else if (is(data, "SingleCellExperiment")) {
        .inputFromSCE
    }
    if (is.null(adapter)) {
        return(plain)
    }
    ## For object inputs `x` names the embedding (default "UMAP"); `y` is
    ## ignored. Default axis labels are replaced by the embedding name.
    adapter(data,
        dimred = .varName(x) %||% "UMAP",
        colorBy = colorBy, groupBy = groupBy, assay = assay,
        xlab = if (identical(xlab, "X")) NULL else xlab,
        ylab = if (identical(ylab, "Y")) NULL else ylab,
        legendTitle = legendTitle
    )
}

## Internal: a bare numeric matrix (reducedDim output, `prcomp()$x`, a UMAP
## embedding). Uses the first two columns unless `x` / `y` give a column
## index or name. Other arguments stay vectors.
.inputFromMatrix <- function(mat, plain) {
    if (ncol(mat) < 2L) {
        stop("A coordinate matrix needs at least two columns.", call. = FALSE)
    }
    plain$x <- .pickMatrixCol(mat, plain$x, 1L)
    plain$y <- .pickMatrixCol(mat, plain$y, 2L)
    plain$data <- NULL
    plain
}

## Internal: select one coordinate column of a matrix.
.pickMatrixCol <- function(mat, sel, default) {
    if (is.null(sel)) {
        return(mat[, default])
    }
    if (is.character(sel) && length(sel) == 1L) {
        if (is.null(colnames(mat)) || !sel %in% colnames(mat)) {
            stop(sprintf("Column '%s' not found in the matrix.", sel),
                call. = FALSE
            )
        }
        return(mat[, sel])
    }
    if (is.numeric(sel) && length(sel) == 1L) {
        return(mat[, as.integer(sel)])
    }
    ## Anything else (a raw vector) is passed straight through.
    sel
}

## Internal: the common return value of the object adapters (SCE, Seurat,
## AnnData). The legend title defaults to the `colorBy` name.
.objectInput <- function(coords, color_vec, group_vec, colorBy,
                         xlab, ylab, legendTitle) {
    list(
        data = data.frame(.x = coords[, 1L], .y = coords[, 2L]),
        x = ".x", y = ".y",
        colorBy = color_vec, groupBy = group_vec,
        xlab = xlab, ylab = ylab,
        legendTitle = legendTitle %||% .varName(colorBy)
    )
}
