## ----------------------------------------------------------------------------
## Internal utilities
## ----------------------------------------------------------------------------

## Internal helper. Base R 4.4+ already exports `%||%` so we don't need to.
`%||%` <- function(x, y) {
    if (is.null(x)) y else x
}

#' Encode a numeric vector as a base64 Float32 payload
#'
#' Serialises a numeric vector as little-endian 32-bit floats and prefixes the
#' result with `"base64:"` so the companion JavaScript widget recognises it as
#' a binary buffer rather than a JSON array. Using this transfer path keeps
#' the payload size at ~25% of the equivalent JSON representation.
#'
#' @param vec Numeric vector. `NULL` is returned unchanged.
#' @return Character string of the form `"base64:..."` or `NULL`.
#' @examples
#' toBase64(c(1, 2, 3.5))
#' @export
toBase64 <- function(vec) {
    if (is.null(vec)) return(NULL)
    if (!is.double(vec)) vec <- as.double(vec)
    con <- rawConnection(raw(0), "r+")
    on.exit(close(con), add = TRUE)
    writeBin(vec, con, size = 4)
    raw_data <- rawConnectionValue(con)
    ## jsonlite::base64_enc is C-backed and ~5x faster than base64enc on
    ## large payloads. Fall back to base64enc when jsonlite isn't loaded.
    encoded <- if (requireNamespace("jsonlite", quietly = TRUE)) {
        jsonlite::base64_enc(raw_data)
    } else {
        base64enc::base64encode(raw_data)
    }
    paste0("base64:", encoded)
}

## Internal helper - writes a 16-bit integer vector to a base64 payload with
## the given prefix. Centralises the rawConnection / writeBin / base64 dance.
.encodeU16 <- function(ints, prefix) {
    con <- rawConnection(raw(0), "r+")
    on.exit(close(con), add = TRUE)
    writeBin(ints, con, size = 2L, endian = "little")
    raw_data <- rawConnectionValue(con)
    encoded <- if (requireNamespace("jsonlite", quietly = TRUE)) {
        jsonlite::base64_enc(raw_data)
    } else {
        base64enc::base64encode(raw_data)
    }
    paste0(prefix, encoded)
}

## Compact encoder for vectors known to live in [-1, 1] (used for X/Y).
## 1/32767 precision (~3e-5) - well below pixel resolution at any zoom.
.toBase64U16 <- function(vec) {
    if (is.null(vec)) return(NULL)
    if (!is.double(vec)) vec <- as.double(vec)
    vec[vec < -1] <- -1
    vec[vec >  1] <-  1
    ints <- as.integer(round((vec + 1) * 32767.5))
    ints[ints < 0L]      <- 0L
    ints[ints > 65535L]  <- 65535L
    .encodeU16(ints, "base64u16:")
}

## Compact encoder for vectors in [0, 1] (used for continuous colour z).
## 1/65535 precision is finer than 8-bit per-channel display output, so
## continuous palettes look bit-identical to the Float32 version.
.toBase64U16Unit <- function(vec) {
    if (is.null(vec)) return(NULL)
    if (!is.double(vec)) vec <- as.double(vec)
    vec[vec < 0] <- 0
    vec[vec > 1] <- 1
    ints <- as.integer(round(vec * 65535))
    ints[ints < 0L]     <- 0L
    ints[ints > 65535L] <- 65535L
    .encodeU16(ints, "base64u16u:")
}

## Compact encoder for small non-negative integers (used for categorical
## colour and group indices). Caps at 65535 categories - well beyond any
## realistic dataset.
.toBase64U16Int <- function(vec) {
    if (is.null(vec)) return(NULL)
    ints <- as.integer(vec)
    if (any(ints < 0L, na.rm = TRUE) || any(ints > 65535L, na.rm = TRUE)) {
        stop(".toBase64U16Int: integers must lie in [0, 65535].", call. = FALSE)
    }
    .encodeU16(ints, "base64u16i:")
}

## Resolve a vmin/vmax specification against a data vector.
## Accepts NULL (fall back to `default_fn`), a numeric scalar, "min", "max",
## or a percentile string like "p99" / "p1.5".
.parseLimit <- function(limit_arg, data_vec, default_fn) {
    if (is.null(limit_arg)) {
        return(as.numeric(default_fn(data_vec, na.rm = TRUE)))
    }
    if (is.numeric(limit_arg)) return(as.numeric(limit_arg))
    if (!is.character(limit_arg) || length(limit_arg) != 1L) {
        stop("`vmin`/`vmax` must be NULL, numeric, or a single string.",
             call. = FALSE)
    }
    val <- if (grepl("^p[0-9]+(\\.[0-9]+)?$", limit_arg)) {
        stats::quantile(data_vec,
                        probs = as.numeric(sub("p", "", limit_arg)) / 100,
                        na.rm = TRUE)
    } else if (limit_arg == "min") {
        min(data_vec, na.rm = TRUE)
    } else if (limit_arg == "max") {
        max(data_vec, na.rm = TRUE)
    } else {
        stop(sprintf("Unrecognised limit '%s'. Use a number, 'min', 'max' or 'pNN'.",
                     limit_arg), call. = FALSE)
    }
    as.numeric(unname(val))
}

## Extract a vector from a data.frame-like object OR pass-through a vector.
## `arg` may be either a column name (length-1 character) when `data` is set,
## or a vector. Returns NULL when `arg` is NULL.
.resolveColumn <- function(arg, data) {
    if (is.null(arg)) return(NULL)
    if (!is.null(data) && is.character(arg) && length(arg) == 1L &&
        arg %in% names(data)) {
        return(data[[arg]])
    }
    arg
}

## Normalise a numeric vector to [-1, 1] using a fixed range.
## Fused expression keeps the temporary count low (matters once `vec` is
## tens of millions of points).
.normaliseRange <- function(vec, lo, hi) {
    if (hi == lo) return(rep.int(0, length(vec)))
    scale <- 2 / (hi - lo)
    out <- (vec - lo) * scale - 1
    out[out < -1] <- -1
    out[out >  1] <-  1
    out
}

## Resolve a `legendPosition` argument to a list the JS layer understands.
## Accepts a named anchor ("top-right" / "top-left" / "bottom-right" /
## "bottom-left") or a length-2 numeric vector c(x_px, y_px).
.resolveLegendPosition <- function(pos) {
    if (is.null(pos)) return(list(anchor = "top-right"))
    if (is.numeric(pos) && length(pos) == 2L) {
        return(list(anchor = "custom",
                    x = as.numeric(pos[1L]),
                    y = as.numeric(pos[2L])))
    }
    valid <- c("top-right", "top-left", "bottom-right", "bottom-left")
    if (is.character(pos) && length(pos) == 1L && pos %in% valid) {
        return(list(anchor = pos))
    }
    stop("`legendPosition` must be one of \"top-right\", \"top-left\", ",
         "\"bottom-right\", \"bottom-left\", or a length-2 numeric c(x, y).",
         call. = FALSE)
}

## Validation: assert that `x` is the right shape for a plot coordinate.
.validateCoord <- function(vec, name) {
    if (is.null(vec)) {
        stop(sprintf("'%s' is required.", name), call. = FALSE)
    }
    if (!is.numeric(vec) && !is.integer(vec)) {
        stop(sprintf("'%s' must be numeric.", name), call. = FALSE)
    }
    if (!length(vec)) {
        stop(sprintf("'%s' has length 0.", name), call. = FALSE)
    }
    invisible(TRUE)
}
