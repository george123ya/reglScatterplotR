## ----------------------------------------------------------------------------
## Payload builders for reglScatterplot()
## ----------------------------------------------------------------------------
##
## Each helper builds one part of the list sent to the JavaScript widget.
## Large vectors are sent as compact base64 buffers (see R/utils.R).


## Internal: validate coordinates and normalise them to [-1, 1].
##
## The default range is the data range plus `padding` on each side. The
## padding lives here rather than in a JS auto-fit, so the axes show the
## padded extent and we never fight regl-scatterplot's edge culling. Users
## who want exact bounds pass `xrange` / `yrange` or `rangePadding = 0`.
.buildCoords <- function(x, y, xrange, yrange, padding) {
    .validateCoord(x, "x")
    .validateCoord(y, "y")
    if (length(x) != length(y)) {
        stop("'x' and 'y' must have the same length.", call. = FALSE)
    }
    x <- as.numeric(x)
    y <- as.numeric(y)
    xrange <- xrange %||% .padRange(range(x, na.rm = TRUE), padding)
    yrange <- yrange %||% .padRange(range(y, na.rm = TRUE), padding)
    list(
        n = length(x),
        xrange = xrange,
        yrange = yrange,
        x_norm = .normaliseRange(x, xrange[1L], xrange[2L]),
        y_norm = .normaliseRange(y, yrange[1L], yrange[2L])
    )
}

## Internal: widen a range by `frac` of its width on each side.
.padRange <- function(r, frac) {
    d <- diff(r)
    if (!is.finite(d) || d == 0) {
        return(r)
    }
    c(r[1L] - d * frac, r[2L] + d * frac)
}

## Internal: point size and opacity defaults that depend on the data size.
## Above 500,000 points the widget runs in performance mode: small opaque
## points and no per-point labels, because tooltips slow rendering down.
.performanceDefaults <- function(n, pointSize, opacity, pointLabels) {
    mode <- n > 500000L
    if (mode) {
        pointSize <- pointSize %||% 1
        opacity <- opacity %||% 1
        pointLabels <- NULL
    } else if (is.null(pointSize)) {
        ## Smaller datasets get larger points so they read well in both the
        ## inline Viewer and the RStudio Zoom popup.
        pointSize <- if (n < 5000L) 5 else if (n < 50000L) 4 else 3
    }
    list(
        mode = mode,
        pointSize = pointSize,
        opacity = opacity %||% 0.8,
        pointLabels = pointLabels
    )
}

## Internal: all per-point data buffers of the widget payload.
.buildDataPayload <- function(inp, coords, col_payload,
                              filterBy, sizeBy, opacityBy, tooltipBy) {
    group_vec <- .resolveColumn(inp$groupBy, inp$data)
    size_vec <- .resolveColumn(sizeBy, inp$data)
    opacity_vec <- .resolveColumn(opacityBy, inp$data)
    list(
        x = .toBase64U16(coords$x_norm),
        y = .toBase64U16(coords$y_norm),
        z = .encodeZ(col_payload$z, col_payload$legend$var_type),
        filter_data = .buildFilterPayload(filterBy),
        group_data = if (!is.null(group_vec)) {
            .toBase64U16Int(as.integer(as.factor(group_vec)) - 1L)
        },
        ## sizeBy and opacityBy share one channel; sizeBy wins if both given.
        w = .buildWeightPayload(size_vec %||% opacity_vec),
        sizeBy = !is.null(size_vec),
        opacityBy = !is.null(opacity_vec),
        tooltip_data = .buildTooltipPayload(tooltipBy, inp$data)
    )
}

## Internal: encode the colour channel with the compact encoder that fits the
## legend type. Falls back to Float32 for the rare "no colour" case.
.encodeZ <- function(z, var_type) {
    if (is.null(z)) {
        return(NULL)
    }
    switch(var_type %||% "",
        continuous = .toBase64U16Unit(z),
        categorical = .toBase64U16Int(z),
        toBase64(z)
    )
}

## Internal: numeric covariates for the range-filter sliders.
.buildFilterPayload <- function(filterBy) {
    if (is.null(filterBy)) {
        return(list())
    }
    if (!is.data.frame(filterBy)) {
        stop("'filterBy' must be a data.frame.", call. = FALSE)
    }
    out <- list()
    for (col in names(filterBy)) {
        out[[col]] <- toBase64(as.numeric(filterBy[[col]]))
    }
    out
}

## Internal: the size/opacity channel, rescaled to [0, 1]. A constant
## variable maps to 0.5.
.buildWeightPayload <- function(w_vec) {
    if (is.null(w_vec)) {
        return(NULL)
    }
    w_num <- as.numeric(w_vec)
    w_rng <- range(w_num, na.rm = TRUE)
    w_unit <- if (diff(w_rng) == 0) {
        rep.int(0.5, length(w_num))
    } else {
        (w_num - w_rng[1L]) / diff(w_rng)
    }
    .toBase64U16Unit(w_unit)
}

## Internal: extra hover fields. `tooltipBy` is column name(s) of a
## data.frame, or a data.frame / named list of vectors. Numeric fields are
## sent as floats; other fields as integer codes plus levels.
.buildTooltipPayload <- function(tooltipBy, data) {
    if (is.null(tooltipBy)) {
        return(NULL)
    }
    tt <- if (is.character(tooltipBy) && is.data.frame(data)) {
        stats::setNames(lapply(tooltipBy, function(cn) data[[cn]]), tooltipBy)
    } else if (is.data.frame(tooltipBy)) {
        as.list(tooltipBy)
    } else if (is.list(tooltipBy)) {
        tooltipBy
    } else {
        stop("'tooltipBy' must be column name(s) (with a data.frame), or a ",
            "data.frame / named list of vectors.",
            call. = FALSE
        )
    }
    lapply(names(tt), function(nm) {
        v <- tt[[nm]]
        if (is.numeric(v)) {
            return(list(name = nm, kind = "num", data = toBase64(as.numeric(v))))
        }
        f <- as.factor(v)
        list(
            name = nm, kind = "cat",
            codes = .toBase64U16Int(as.integer(f) - 1L),
            levels = I(as.character(levels(f)))
        )
    })
}

## Internal: htmlwidgets sizing defaults.
.widgetSizingPolicy <- function() {
    htmlwidgets::sizingPolicy(
        defaultWidth = "100%",
        defaultHeight = 500,
        padding = 0,
        browser.fill = TRUE,
        viewer.fill = TRUE,
        knitr.figure = FALSE,
        viewer.suppress = FALSE,
        knitr.defaultWidth = "100%",
        knitr.defaultHeight = 500
    )
}
