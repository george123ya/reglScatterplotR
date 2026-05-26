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
## Returns a list with elements `options`, `legend_data`, `z_norm`.
.buildColorPayload <- function(color_vec,
                               color_var_name,
                               legend_title,
                               point_color,
                               categorical_palette,
                               continuous_palette,
                               custom_palette,
                               custom_colors,
                               vmin, vmax, center_zero) {
    options <- list()
    legend_data <- list()
    z_norm <- NULL

    if (!is.null(point_color)) {
        options$pointColor <- point_color
        options$colorBy <- NULL
        return(list(options = options, legend = legend_data, z = z_norm))
    }

    if (is.null(color_vec)) {
        options$pointColor <- "#0072B2"
        options$colorBy <- NULL
        return(list(options = options, legend = legend_data, z = z_norm))
    }

    if (is.character(color_vec) || is.factor(color_vec)) {
        f <- as.factor(color_vec)
        lvls <- levels(f)
        hex_cols <- .resolveCategoricalPalette(
            lvls, custom_colors,
            custom_palette,
            categorical_palette
        )
        z_norm <- as.integer(f) - 1L
        options$colorBy <- "valueA"
        options$pointColor <- as.vector(hex_cols)
        legend_data <- list(
            names = I(lvls),
            colors = I(as.vector(hex_cols)),
            var_type = "categorical",
            title = legend_title,
            var_name = color_var_name
        )
        return(list(options = options, legend = legend_data, z = z_norm))
    }

    if (is.numeric(color_vec)) {
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

        options$colorBy <- "valueA"
        options$pointColor <- p_hex
        legend_data <- list(
            minVal = c_min,
            maxVal = c_max,
            midVal = (c_min + c_max) / 2,
            var_type = "continuous",
            colors = p_hex,
            title = legend_title %||% "Value",
            var_name = color_var_name
        )
        return(list(options = options, legend = legend_data, z = z_norm))
    }

    stop("`colorBy` must be NULL, character, factor or numeric.", call. = FALSE)
}
