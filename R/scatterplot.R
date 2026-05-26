## ----------------------------------------------------------------------------
## reglScatterplot() - the main widget constructor
## ----------------------------------------------------------------------------

#' Interactive WebGL scatterplot
#'
#' Renders a `regl-scatterplot` widget capable of displaying millions of
#' points in the browser. Works in standalone HTML, the RStudio Viewer,
#' Shiny applications and Jupyter notebooks (via IRkernel).
#'
#' @param data Optional `data.frame` (or any object that supports `[[`).
#'   When supplied, `x`, `y`, `colorBy`, `groupBy` and the columns named in
#'   `filterBy` are looked up by name in `data`. When `NULL`, these arguments
#'   must be vectors of matching length.
#' @param x,y Either column names (when `data` is non-NULL) or numeric vectors
#'   giving point coordinates. For `SingleCellExperiment` / `SpatialExperiment`
#'   inputs, pass the `reducedDim` name as `x` (e.g. `"UMAP"`); `y` is
#'   ignored. Use `"spatial"` for tissue coordinates on a `SpatialExperiment`.
#' @param assay Name of the assay to read when `colorBy` names a feature
#'   row of an `SCE` (default `"logcounts"`, falls back to assay #1).
#'   Ignored for plain data frames.
#' @param colorBy Optional column name or vector used to colour points.
#'   Character/factor input is treated as categorical, numeric as continuous.
#' @param groupBy Optional column name or vector. Used by the legend to expose
#'   a second categorical filter that intersects with `colorBy`.
#' @param filterBy Optional `data.frame` of additional numeric covariates that
#'   the JavaScript widget exposes for range filtering.
#' @param pointSize,opacity Numeric. When `NULL`, sensible defaults are picked
#'   based on the number of points (`pointSize = 3` and `opacity = 0.8` for
#'   small data; `pointSize = 1`, `opacity = 1` once `n > 500000`).
#' @param pointColor Optional fixed hex colour. When given, overrides
#'   `colorBy`.
#' @param categoricalPalette,continuousPalette Names of fallback palettes
#'   (a `RColorBrewer` name and a `viridisLite` name respectively).
#' @param customPalette,customColors Optional explicit palettes. `customColors`
#'   is a named character vector mapping level -> hex; `customPalette` is an
#'   unnamed vector used in level order.
#' @param pointLabels Optional character vector aligned to the points; shown
#'   in the hover tooltip. Use this for gene names, cell barcodes, etc.
#' @param xlab,ylab,title,legendTitle Axis/labels.
#' @param xrange,yrange Optional length-2 numeric vectors fixing the axes
#'   instead of using the data range. When supplied, they bypass the
#'   automatic padding from `rangePadding`.
#' @param rangePadding Fractional padding added to each side of the data
#'   range when `xrange` / `yrange` aren't supplied (default `0.1` =
#'   10% on each side, matching the `ggplot2` convention). Set to `0`
#'   to draw exactly the data range.
#' @param vmin,vmax Continuous-colour clipping. Accepts a number, `"min"`,
#'   `"max"`, or a percentile string like `"p99"`.
#' @param centerZero Logical. If `TRUE`, the continuous colour scale is forced
#'   to be symmetric around zero (useful for log-fold-change displays).
#' @param showAxes,showTooltip Logical toggles.
#' @param backgroundColor,axisColor,legendBg,legendText Hex colour overrides
#'   for cosmetic styling.
#' @param legendPosition Starting position of the legend. One of
#'   `"top-right"` (default), `"top-left"`, `"bottom-right"`, `"bottom-left"`,
#'   or a length-2 numeric vector `c(x, y)` giving absolute pixel offsets
#'   from the top-left of the plot.
#' @param draggableLegend Logical; when `TRUE` (default), the legend can be
#'   dragged with the mouse. Set to `FALSE` to pin it to `legendPosition`.
#' @param width,height Widget dimensions (any valid CSS unit). When `NULL`,
#'   `htmlwidgets` picks defaults appropriate to the host context.
#' @param enableDownload Logical. Show the download (PNG/SVG/PDF) button.
#'   Defaults to `FALSE` because the button is unreliable inside IDE iframes
#'   (RStudio Viewer, VSCode Jupyter), where browser download dialogs and
#'   `html2canvas`/`jsPDF` script injections often fail. Set to `TRUE`
#'   explicitly for standalone HTML files or Shiny apps; even then the
#'   button is hidden automatically when the widget is running inside an
#'   IDE iframe.
#' @param plotId Optional string identifying the plot. Required when linking
#'   plots together via [enableReglScatterplotSync()].
#' @param syncPlots Optional character vector of plot ids to sync with.
#' @param elementId DOM id for the containing div (passed to `htmlwidgets`).
#' @param dataVersion Optional integer/string used by the JS layer to detect
#'   when the underlying data has changed.
#' @param masterId Optional id of another plot whose camera should seed this
#'   one's view (used when a plot is added to an already-synced group).
#' @param autoFit Logical. When `TRUE`, the camera zooms to fit the data
#'   region exactly on initial render.
#' @param margins Optional `list(top, right, bottom, left)` of pixel margins.
#' @param fontSize,legendFontSize Numeric font sizes in pixels.
#' @param filteredIndices,selectedIndices Optional 0-based integer vectors
#'   for server-driven filtering / selection.
#' @param syncState Logical. When `FALSE`, the widget starts with global sync
#'   disabled.
#'
#' @return An `htmlwidgets` object of class `"reglScatterplot"`.
#'
#' @section Bioconductor data structures:
#' When `data` is a `SingleCellExperiment` or `SpatialExperiment`, the
#' function reroutes through a helper that pulls coordinates from
#' `reducedDim()` (e.g. `dimred = "UMAP"`) - or from `spatialCoords()` when
#' `dimred = "spatial"` for a `SpatialExperiment`. `colorBy` and `groupBy`
#' may then name either a `colData` column or a feature in `rownames(sce)`
#' (in the latter case `assay()` is read - `"logcounts"` by default, or the
#' assay named by the `assay` argument).
#'
#' @examples
#' set.seed(1L)
#' df <- data.frame(
#'     x = rnorm(2000),
#'     y = rnorm(2000),
#'     group = sample(letters[1:4], 2000, replace = TRUE),
#'     score = runif(2000)
#' )
#' reglScatterplot(df, x = "x", y = "y", colorBy = "group")
#' reglScatterplot(df,
#'     x = "x", y = "y", colorBy = "score",
#'     continuousPalette = "magma"
#' )
#'
#' \donttest{
#' # Single-cell UMAP from a SingleCellExperiment
#' # reglScatterplot(sce, dimred = "UMAP", colorBy = "cluster")
#' # Colour by a gene
#' # reglScatterplot(sce, dimred = "UMAP", colorBy = "MS4A1")
#' # Spatial coordinates from a SpatialExperiment
#' # reglScatterplot(spe, dimred = "spatial", colorBy = "celltype")
#' }
#'
#' @seealso [enableReglScatterplotSync()], [updateReglPointSize()]
#' @export
reglScatterplot <- function(data = NULL,
                            x, y,
                            colorBy = NULL,
                            groupBy = NULL,
                            assay = NULL,
                            filterBy = NULL,
                            pointSize = NULL,
                            opacity = NULL,
                            pointColor = NULL,
                            categoricalPalette = "Set1",
                            continuousPalette = "viridis",
                            customPalette = NULL,
                            customColors = NULL,
                            pointLabels = NULL,
                            xlab = "X", ylab = "Y",
                            title = NULL,
                            legendTitle = NULL,
                            xrange = NULL, yrange = NULL,
                            rangePadding = 0.15,
                            vmin = NULL, vmax = NULL,
                            centerZero = FALSE,
                            showAxes = TRUE,
                            showTooltip = TRUE,
                            backgroundColor = NULL,
                            axisColor = "#333333",
                            legendBg = "#ffffff",
                            legendText = "#000000",
                            legendPosition = "top-right",
                            draggableLegend = TRUE,
                            width = NULL, height = NULL,
                            enableDownload = FALSE,
                            plotId = NULL,
                            syncPlots = NULL,
                            elementId = NULL,
                            dataVersion = NULL,
                            masterId = NULL,
                            autoFit = FALSE,
                            margins = NULL,
                            fontSize = 12,
                            legendFontSize = 12,
                            filteredIndices = NULL,
                            selectedIndices = NULL,
                            syncState = TRUE) {
    ## ---- Bioconductor object dispatch -----------------------------------
    if (!is.null(data) &&
        (inherits(data, "SingleCellExperiment") ||
            inherits(data, "SpatialExperiment"))) {
        ## Resolve `x` as the `dimred` argument (default "UMAP") so the user
        ## writes reglScatterplot(sce, dimred = "UMAP") and we don't fight
        ## the existing positional signature.
        dimred <- if (!missing(x) && is.character(x) && length(x) == 1L) {
            x
        } else {
            "UMAP"
        }
        return(.reglScatterplotFromSCE(
            sce = data,
            dimred = dimred,
            colorBy = colorBy,
            groupBy = groupBy,
            assay = assay,
            xlab = if (xlab == "X") NULL else xlab,
            ylab = if (ylab == "Y") NULL else ylab,
            ## Forward everything else with explicit names.
            filterBy = filterBy,
            pointSize = pointSize, opacity = opacity,
            pointColor = pointColor,
            categoricalPalette = categoricalPalette,
            continuousPalette = continuousPalette,
            customPalette = customPalette,
            customColors = customColors,
            pointLabels = pointLabels,
            title = title, legendTitle = legendTitle,
            xrange = xrange, yrange = yrange,
            vmin = vmin, vmax = vmax, centerZero = centerZero,
            showAxes = showAxes, showTooltip = showTooltip,
            backgroundColor = backgroundColor,
            axisColor = axisColor,
            legendBg = legendBg, legendText = legendText,
            legendPosition = legendPosition,
            draggableLegend = draggableLegend,
            width = width, height = height,
            enableDownload = enableDownload,
            plotId = plotId, syncPlots = syncPlots,
            elementId = elementId,
            dataVersion = dataVersion,
            masterId = masterId,
            autoFit = autoFit,
            margins = margins,
            fontSize = fontSize, legendFontSize = legendFontSize,
            filteredIndices = filteredIndices,
            selectedIndices = selectedIndices,
            syncState = syncState
        ))
    }

    ## ---- data extraction -------------------------------------------------
    x_vec <- .resolveColumn(x, data)
    y_vec <- .resolveColumn(y, data)
    color_vec <- .resolveColumn(colorBy, data)
    group_vec <- .resolveColumn(groupBy, data)

    .validateCoord(x_vec, "x")
    .validateCoord(y_vec, "y")
    if (length(x_vec) != length(y_vec)) {
        stop("'x' and 'y' must have the same length.", call. = FALSE)
    }

    x_vec <- as.numeric(x_vec)
    y_vec <- as.numeric(y_vec)
    n_points <- length(x_vec)

    ## ---- adaptive performance defaults -----------------------------------
    performance_mode <- n_points > 500000L
    if (performance_mode) {
        if (is.null(pointSize)) pointSize <- 1
        if (is.null(opacity)) opacity <- 1
        pointLabels <- NULL # tooltips kill perf
    } else if (is.null(pointSize)) {
        ## Smaller datasets get visibly larger points so they read well in
        ## both the inline Viewer and the RStudio Zoom popup.
        pointSize <- if (n_points < 5000L) 5 else if (n_points < 50000L) 4 else 3
    }
    if (is.null(opacity)) opacity <- 0.8

    ## ---- coordinate normalisation ----------------------------------------
    ## Default to data range + `rangePadding` on each side. The padding lives
    ## inside the normalisation rather than inside any JS auto-fit so the
    ## displayed axes reflect the padded extent and we never fight
    ## regl-scatterplot's edge culling (it applies a small constant pixel
    ## margin we can't predict). Users who want exact data bounds can pass
    ## `xrange = range(x_vec), yrange = range(y_vec)` or
    ## `rangePadding = 0`.
    .padRange <- function(r, frac) {
        d <- diff(r)
        if (!is.finite(d) || d == 0) {
            return(r)
        }
        c(r[1L] - d * frac, r[2L] + d * frac)
    }
    xrange <- xrange %||% .padRange(range(x_vec, na.rm = TRUE), rangePadding)
    yrange <- yrange %||% .padRange(range(y_vec, na.rm = TRUE), rangePadding)

    x_norm <- .normaliseRange(x_vec, xrange[1L], xrange[2L])
    y_norm <- .normaliseRange(y_vec, yrange[1L], yrange[2L])

    ## ---- variable names for legend/registry ------------------------------
    color_var_name <- if (is.character(colorBy) && length(colorBy) == 1L) {
        colorBy
    } else {
        "Solid_Color"
    }
    group_var_name <- if (is.character(groupBy) && length(groupBy) == 1L) {
        groupBy
    } else {
        NULL
    }

    ## ---- colours ---------------------------------------------------------
    col_payload <- .buildColorPayload(
        color_vec = color_vec,
        color_var_name = color_var_name,
        legend_title = legendTitle,
        point_color = pointColor,
        categorical_palette = categoricalPalette,
        continuous_palette = continuousPalette,
        custom_palette = customPalette,
        custom_colors = customColors,
        vmin = vmin, vmax = vmax,
        center_zero = centerZero
    )

    options <- col_payload$options
    options$size <- pointSize
    options$opacity <- opacity
    legend_data <- col_payload$legend
    z_norm <- col_payload$z

    ## ---- per-variable filter payload -------------------------------------
    filter_payload <- list()
    if (!is.null(filterBy)) {
        if (!is.data.frame(filterBy)) {
            stop("'filterBy' must be a data.frame.", call. = FALSE)
        }
        for (col in names(filterBy)) {
            filter_payload[[col]] <- toBase64(as.numeric(filterBy[[col]]))
        }
    }

    group_payload <- NULL
    if (!is.null(group_vec)) {
        group_payload <- .toBase64U16Int(as.integer(as.factor(group_vec)) - 1L)
    }

    ## Pick the compact z encoder based on the legend's var_type. Falls back
    ## to Float32 for the (rare) "no colour" case.
    z_payload <- if (is.null(z_norm)) {
        NULL
    } else {
        switch(legend_data$var_type %||% "",
            continuous  = .toBase64U16Unit(z_norm),
            categorical = .toBase64U16Int(z_norm),
            toBase64(z_norm)
        )
    }

    margins <- margins %||% list(top = 20, right = 20, bottom = 40, left = 50)

    legend_anchor <- .resolveLegendPosition(legendPosition)

    widget_spec <- list(
        x = .toBase64U16(x_norm),
        y = .toBase64U16(y_norm),
        z = z_payload,
        filter_data = filter_payload,
        group_data = group_payload,
        n_points = n_points,
        options = options,
        legend = legend_data,
        x_min = xrange[1L], x_max = xrange[2L],
        y_min = yrange[1L], y_max = yrange[2L],
        xlab = xlab, ylab = ylab, title = title,
        showAxes = showAxes, showTooltip = showTooltip,
        backgroundColor = backgroundColor,
        axisColor = axisColor,
        legendBg = legendBg, legendText = legendText,
        legendAnchor = legend_anchor, draggableLegend = isTRUE(draggableLegend),
        enableDownload = enableDownload,
        gene_names = if (!is.null(pointLabels)) as.character(pointLabels) else NULL,
        plotId = plotId, syncPlots = syncPlots,
        dataVersion = dataVersion,
        performanceMode = performance_mode,
        masterId = masterId,
        autoFit = autoFit,
        margins = margins,
        fontSize = fontSize,
        legendFontSize = legendFontSize,
        init_server_indices = if (!is.null(filteredIndices)) as.integer(filteredIndices),
        init_selected_indices = if (!is.null(selectedIndices)) as.integer(selectedIndices),
        syncState = syncState,
        colorVar = color_var_name,
        groupVar = group_var_name
    )

    htmlwidgets::createWidget(
        name = "reglScatterplot", # widget name (matches inst/htmlwidgets/reglScatterplot.js)
        x = widget_spec,
        width = width,
        height = height,
        package = "reglScatterplotR",
        elementId = elementId,
        sizingPolicy = htmlwidgets::sizingPolicy(
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
    )
}
