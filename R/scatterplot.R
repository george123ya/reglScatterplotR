## ----------------------------------------------------------------------------
## reglScatterplot() - the main widget constructor
## ----------------------------------------------------------------------------

#' Interactive WebGL scatterplot
#'
#' Renders a `regl-scatterplot` widget capable of displaying millions of
#' points in the browser. Works in standalone HTML, the RStudio Viewer,
#' Shiny applications and Jupyter notebooks (via IRkernel).
#'
#' @param data Optional input object. Accepts a `data.frame` (or anything that
#'   supports `[[`), a numeric coordinate `matrix`, a `SingleCellExperiment`, a
#'   `SpatialExperiment`, a `Seurat` object, or an in-memory `AnnData` (from the
#'   `anndataR` or `anndata` packages). For a `data.frame`, `x`, `y`,
#'   `colorBy`, `groupBy` and the columns named in `filterBy` are looked up by
#'   name. For a `matrix`, the first two columns are used as coordinates unless
#'   `x` / `y` give column indices or names. When `NULL`, these arguments must
#'   be vectors of matching length. For single-cell objects, see the
#'   *Single-cell data structures* section below.
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
#' @param sizeBy,opacityBy Optional numeric column name or vector mapped to point
#'   size / opacity. They share one data channel, so both encode the same
#'   variable.
#' @param tooltipBy Optional extra fields to show on hover: column name(s) (when
#'   `data` is a data.frame) or a data.frame / named list of vectors.
#' @param pixelRatio Optional numeric device-pixel-ratio for the WebGL backing
#'   store. When `NULL` (default) the widget renders at `max(devicePixelRatio,
#'   2)` for crisp output - this matters in the RStudio Viewer, an embedded
#'   browser that reports `devicePixelRatio = 1` even on HiDPI screens, making
#'   the plot look soft at the library default. For very large data
#'   (`n > 500000`, performance mode) the true ratio is used to keep the pixel
#'   count down. Pass an explicit value (e.g. `1` to save GPU memory, `3` for
#'   extra-sharp export-quality rendering) to override.
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
#' @param legendOpacity Opacity (0-1) of the frosted legend card background.
#'   `NULL` (default) uses `0.55`.
#' @param legendBlur Backdrop blur in pixels behind the legend card. `NULL`
#'   (default) uses `10`; set `0` to disable the frosted effect.
#' @param toolbarPosition Show an in-plot toolbar (pan / lasso / zoom-to-
#'   selection / reset / screenshot). One of `"none"` (default), `"left"`
#'   (vertical) or `"top"` (horizontal).
#' @param zoomOnSelection Logical; when `TRUE`, the camera zooms to fit the
#'   lasso-selected points.
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
#' @section Single-cell data structures:
#' When `data` is a `SingleCellExperiment` or `SpatialExperiment`, the
#' function reroutes through a helper that pulls coordinates from
#' `reducedDim()` (e.g. `x = "UMAP"`) - or from `spatialCoords()` when
#' `x = "spatial"` for a `SpatialExperiment`. `colorBy` and `groupBy`
#' may then name either a `colData` column or a feature in `rownames(sce)`
#' (in the latter case `assay()` is read - `"logcounts"` by default, or the
#' assay named by the `assay` argument).
#'
#' When `data` is a `Seurat` object, coordinates come from `Embeddings()` for
#' the reduction named by `x` (default `"UMAP"`, matched case-insensitively;
#' falls back to the first of `umap`/`tsne`/`pca` present). `colorBy` and
#' `groupBy` are resolved with `FetchData()`, so they may name either a
#' `meta.data` column or a feature. For Seurat, the `assay` argument selects
#' the *layer* to read for features (`"data"`, i.e. log-normalised, by
#' default; works with both v4 `slot`s and v5 `layer`s); to colour by a
#' non-default modality such as ADT, set `Seurat::DefaultAssay()` before
#' calling.
#'
#' When `data` is an in-memory `AnnData` (from `anndataR` or the `anndata`
#' CRAN package), coordinates come from an `obsm` embedding named by `x`
#' (default `"UMAP"`, auto-prefixed to the scanpy-style `"X_umap"` and matched
#' case-insensitively). `colorBy` / `groupBy` resolve against `obs` columns or
#' `var_names` features, and `assay` selects the layer to read for features
#' (`NULL` -> `X`, a layer name, or `"raw"`). An AnnData read with
#' `zellkonverter::readH5AD()` arrives as a `SingleCellExperiment` and uses the
#' SCE path above instead.
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
                            sizeBy = NULL,
                            opacityBy = NULL,
                            tooltipBy = NULL,
                            pixelRatio = NULL,
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
                            legendOpacity = NULL,
                            legendBlur = NULL,
                            toolbarPosition = "none",
                            zoomOnSelection = FALSE,
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
    ## Unwrap a crosstalk::SharedData so the plot links (selection + filter)
    ## with other crosstalk widgets (DT, plotly, leaflet) in the same document.
    ct <- .unwrapCrosstalk(data)

    ## Turn any supported input (data.frame, matrix, SingleCellExperiment,
    ## SpatialExperiment, Seurat, AnnData) into coordinate and colour vectors.
    inp <- .resolveInput(ct$data,
        x = if (missing(x)) NULL else x,
        y = if (missing(y)) NULL else y,
        colorBy = colorBy, groupBy = groupBy, assay = assay,
        xlab = xlab, ylab = ylab, legendTitle = legendTitle
    )

    coords <- .buildCoords(
        .resolveColumn(inp$x, inp$data), .resolveColumn(inp$y, inp$data),
        xrange, yrange, rangePadding
    )
    perf <- .performanceDefaults(coords$n, pointSize, opacity, pointLabels)

    color_var_name <- .varName(inp$colorBy) %||% "Solid_Color"
    col_payload <- .buildColorPayload(
        color_vec = .resolveColumn(inp$colorBy, inp$data),
        color_var_name = color_var_name,
        legend_title = inp$legendTitle,
        point_color = pointColor,
        categorical_palette = categoricalPalette,
        continuous_palette = continuousPalette,
        custom_palette = customPalette,
        custom_colors = customColors,
        vmin = vmin, vmax = vmax,
        center_zero = centerZero
    )
    options <- col_payload$options
    options$size <- perf$pointSize
    options$opacity <- perf$opacity

    payload <- .buildDataPayload(inp, coords, col_payload,
        filterBy = filterBy, sizeBy = sizeBy, opacityBy = opacityBy,
        tooltipBy = tooltipBy
    )
    widget_spec <- c(payload, list(
        n_points = coords$n, pixelRatio = pixelRatio, options = options,
        legend = col_payload$legend,
        x_min = coords$xrange[1L], x_max = coords$xrange[2L],
        y_min = coords$yrange[1L], y_max = coords$yrange[2L],
        xlab = inp$xlab, ylab = inp$ylab, title = title,
        showAxes = showAxes, showTooltip = showTooltip,
        backgroundColor = backgroundColor, axisColor = axisColor,
        legendBg = legendBg, legendText = legendText,
        legendOpacity = legendOpacity, legendBlur = legendBlur,
        toolbarPosition = toolbarPosition,
        zoomOnSelection = isTRUE(zoomOnSelection),
        legendAnchor = .resolveLegendPosition(legendPosition),
        draggableLegend = isTRUE(draggableLegend),
        enableDownload = enableDownload,
        gene_names = if (!is.null(perf$pointLabels)) {
            as.character(perf$pointLabels)
        },
        plotId = plotId, syncPlots = syncPlots, dataVersion = dataVersion,
        performanceMode = perf$mode, masterId = masterId, autoFit = autoFit,
        margins = margins %||%
            list(top = 20, right = 20, bottom = 40, left = 50),
        fontSize = fontSize, legendFontSize = legendFontSize,
        init_server_indices = if (!is.null(filteredIndices)) {
            as.integer(filteredIndices)
        },
        init_selected_indices = if (!is.null(selectedIndices)) {
            as.integer(selectedIndices)
        },
        syncState = syncState,
        colorVar = color_var_name,
        groupVar = .varName(inp$groupBy),
        crosstalk = .crosstalkSpec(ct)
    ))

    htmlwidgets::createWidget(
        name = "reglScatterplot", # matches inst/htmlwidgets/reglScatterplot.js
        x = widget_spec,
        width = width,
        height = height,
        package = "reglScatterplotR",
        elementId = elementId,
        dependencies = if (!is.null(ct$group)) crosstalk::crosstalkLibs(),
        sizingPolicy = .widgetSizingPolicy()
    )
}
