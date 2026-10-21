## ----------------------------------------------------------------------------
## Colour resolution helpers used by reglScatterplot()
## ----------------------------------------------------------------------------

## Convert any acceptable colour representation to a 7-char hex string.
.toHex7 <- function(col) {
    if (grepl("^#", col)) {
        return(substr(col, 1L, 7L))
    }
    grDevices::rgb(t(grDevices::col2rgb(col)), maxColorValue = 255)
}

## Build the palette for a categorical colour vector.
##
## @param levels character vector of factor levels (ordered).
## @param custom_colors named vector mapping level -> hex (optional).
## @param custom_palette unnamed or named palette (optional).
## @param categorical_palette name of a `RColorBrewer` palette (fallback).
## @return character vector of hex colours, same length as `levels`.
.resolveCategoricalPalette <- function(levels, custom_colors = NULL,
                                       custom_palette = NULL,
                                       categorical_palette = "Set1") {
    n <- length(levels)
    cols <- rep(NA_character_, n)

    if (!is.null(custom_colors) && length(custom_colors) > 0L) {
        cols <- unname(custom_colors[levels])
    } else if (!is.null(custom_palette)) {
        if (!is.null(names(custom_palette))) {
            cols <- unname(custom_palette[levels])
        } else {
            cols <- custom_palette[seq_len(min(n, length(custom_palette)))]
            if (length(cols) < n) cols <- c(cols, rep(NA_character_, n - length(cols)))
        }
    }

    if (any(is.na(cols))) {
        max_n <- RColorBrewer::brewer.pal.info[categorical_palette, "maxcolors"]
        brewer_n <- min(max(n, 3L), max_n)
        fallback <- RColorBrewer::brewer.pal(brewer_n, categorical_palette)
        if (n > max_n) {
            fallback <- grDevices::colorRampPalette(fallback)(n)
        } else {
            fallback <- fallback[seq_len(n)]
        }
        cols[is.na(cols)] <- fallback[is.na(cols)]
    }
    cols[is.na(cols)] <- "#808080"

    vapply(cols, .toHex7, character(1L), USE.NAMES = FALSE)
}

## Build a 256-step continuous palette by name.
.resolveContinuousPalette <- function(name = "viridis") {
    fn <- switch(name,
        viridis = viridisLite::viridis,
        magma   = viridisLite::magma,
        plasma  = viridisLite::plasma,
        inferno = viridisLite::inferno,
        cividis = viridisLite::cividis,
        turbo   = viridisLite::turbo,
        viridisLite::viridis
    )
    substr(fn(256L), 1L, 7L)
}

## Compute the colour-related portion of the widget payload.
## Returns a list with elements `options`, `legend`, `z`.
.buildColorPayload <- function(color_vec,
                               color_var_name,
                               legend_title,
                               point_color,
                               categorical_palette,
                               continuous_palette,
                               custom_palette,
                               custom_colors,
                               vmin, vmax, center_zero) {
    if (!is.null(point_color) || is.null(color_vec)) {
        ## One solid colour: the user's, or the default blue.
        options <- list(pointColor = point_color %||% "#0072B2")
        return(list(options = options, legend = list(), z = NULL))
    }
    if (is.character(color_vec) || is.factor(color_vec)) {
        return(.categoricalColorPayload(
            color_vec, color_var_name, legend_title,
            custom_colors, custom_palette, categorical_palette
        ))
    }
    if (is.numeric(color_vec)) {
        return(.continuousColorPayload(
            color_vec, color_var_name, legend_title,
            continuous_palette, vmin, vmax, center_zero
        ))
    }
    stop("`colorBy` must be NULL, character, factor or numeric.", call. = FALSE)
}

## Colour payload for a character / factor vector: one palette entry per
## level, and z holds 0-based level codes.
.categoricalColorPayload <- function(color_vec, color_var_name, legend_title,
                                     custom_colors, custom_palette,
                                     categorical_palette) {
    ## Make NA an explicit "NA" level so partially-annotated columns still
    ## colour every point (matches the Python side).
    if (anyNA(color_vec)) {
        f <- addNA(as.factor(color_vec))
        levels(f)[is.na(levels(f))] <- "NA"
    } else {
        f <- as.factor(color_vec)
    }
    lvls <- levels(f)
    hex_cols <- as.vector(.resolveCategoricalPalette(
        lvls, custom_colors, custom_palette, categorical_palette
    ))
    list(
        options = list(colorBy = "valueA", pointColor = hex_cols),
        legend = list(
            names = I(lvls),
            colors = I(hex_cols),
            counts = unname(as.integer(table(f)[lvls])),
            var_type = "categorical",
            title = legend_title,
            var_name = color_var_name
        ),
        z = as.integer(f) - 1L
    )
}

## Colour payload for a numeric vector: z is the value rescaled to [0, 1]
## between the (optionally zero-centred) colour limits.
.continuousColorPayload <- function(color_vec, color_var_name, legend_title,
                                    continuous_palette, vmin, vmax,
                                    center_zero) {
    c_min <- .parseLimit(vmin, color_vec, min)
    c_max <- .parseLimit(vmax, color_vec, max)
    if (center_zero) {
        abs_lim <- max(abs(c_min), abs(c_max))
        c_min <- -abs_lim
        c_max <- abs_lim
    }
    rng <- c_max - c_min
    if (rng == 0) rng <- 1
    ## Fused clip + scale; avoids two extra full-length allocations.
    z_norm <- (color_vec - c_min) / rng
    z_norm[z_norm < 0] <- 0
    z_norm[z_norm > 1] <- 1

    p_hex <- .resolveContinuousPalette(continuous_palette)
    list(
        options = list(colorBy = "valueA", pointColor = p_hex),
        legend = list(
            minVal = c_min,
            maxVal = c_max,
            midVal = (c_min + c_max) / 2,
            var_type = "continuous",
            colors = p_hex,
            title = legend_title,
            var_name = color_var_name
        ),
        z = z_norm
    )
}
