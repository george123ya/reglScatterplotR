#' Scalable scatterplot HTML widget
#'
#' Create an interactive scalable scatterplot using the `regl-scatterplot` JavaScript library.
#'
#' @param x numeric vector of x coordinates, or a column name for x in \code{data}.
#' @param y numeric vector of y coordinates, or a column name for y in \code{data}.
#' @param colorBy factor/chr/numeric vector to color by, or a column name for colorBy in \code{data}.
#' @param data optional data.frame containing the data to plot.
#' @param size point size.
#' @param categorical_palette string name for a categorical RColorBrewer palette (e.g., "Set1", "Set2").
#' @param continuous_palette string name for a continuous viridisLite palette (e.g., "viridis", "inferno").
#' @param xlab x-axis label.
#' @param ylab y-axis label.
#' @param showAxes logical; show axes and labels (default TRUE).
#' @param showTooltip logical; enable hover tooltips (default TRUE).
#' @param pointColor optional uniform hex color for points (e.g., "#FF0000"); overrides colorBy.
#' @param opacity numeric; point opacity (0-1, default 0.8).
#' @param backgroundColor optional hex color for canvas background (default white).
#' @param width fixed width of the canvas in pixels (default is resizable).
#' @param height fixed height of the canvas in pixels (default is resizable).
#' @param elementId specify id for the containing div.
#'
#' @import htmlwidgets
#' @importFrom RColorBrewer brewer.pal
#' @importFrom grDevices col2rgb colorRampPalette rgb
#' @importFrom viridisLite viridis
#' @importFrom viridisLite magma
#' @importFrom viridisLite plasma
#' @importFrom viridisLite inferno
#'
#' @examples
#' data(quakes)
#'
#' # Continuous color scale
#' my_scatterplot(quakes$long, quakes$lat, colorBy = quakes$depth, 
#'                continuous_palette = "inferno", showAxes = TRUE, showTooltip = TRUE)
#' 
#' # No axes, uniform color, custom opacity
#' my_scatterplot(quakes$long, quakes$lat, pointColor = "#0072B2", 
#'                showAxes = FALSE, opacity = 0.6, width = 800, height = 600)
#' 
#' # Add a categorical variable for demonstration
#' quakes$magType <- ifelse(quakes$mag > 5, "high", "low")
#' 
#' # Pass a data.frame with categorical data and a custom palette
#' my_scatterplot(
#'   x = "long",
#'   y = "lat",
#'   colorBy = "magType",
#'   data = quakes,
#'   categorical_palette = "Set2",
#'   backgroundColor = "#F0F8FF"
#' )
#' 
#' @export
my_scatterplot <- function(x, y, colorBy = NULL, data = NULL, size = 3, 
                           categorical_palette = "Set1", continuous_palette = "viridis", 
                           xlab = "X", ylab = "Y", showAxes = TRUE, showTooltip = TRUE, 
                           pointColor = NULL, opacity = 0.8, backgroundColor = NULL, 
                           width = NULL, height = NULL, elementId = NULL) {
  
  if (!is.null(data)) {
    x <- data[, x]
    y <- data[, y]
    if (!is.null(colorBy)) {
      colorBy <- data[, colorBy]
    }
  }

  if (!is.numeric(x) || !is.numeric(y)) {
    stop("x and y coordinates must be numeric")
  }

  # Compute original domains for axes
  x_min <- min(x, na.rm = TRUE)
  x_max <- max(x, na.rm = TRUE)
  y_min <- min(y, na.rm = TRUE)
  y_max <- max(y, na.rm = TRUE)

  # Normalize coordinates to the [-1, 1] range required by regl-scatterplot.
  x_normalized <- -1 + 2 * (x - x_min) / (x_max - x_min)
  y_normalized <- -1 + 2 * (y - y_min) / (y_max - y_min)
  
  points <- data.frame(x = x_normalized, y = y_normalized)

  options <- list(
    size = size,
    opacity = opacity
  )
  
  legend_data <- list()
  
  if (!is.null(pointColor)) {
    # Uniform color override
    options$pointColor <- pointColor
  } else if (!is.null(colorBy)) {
    if (is.character(colorBy) || is.factor(colorBy)) {
      var_type <- "categorical"
      levels <- levels(as.factor(colorBy))
      
      plot_colors <- RColorBrewer::brewer.pal(min(length(levels), 11), categorical_palette)
      if (length(levels) > 11) {
        plot_colors <- colorRampPalette(plot_colors)(length(levels))
      }
      
      # Convert colors to 6-digit hex format for JavaScript.
      hex_colors <- apply(col2rgb(plot_colors), 2, function(col) rgb(col[1], col[2], col[3], maxColorValue = 255))
      
      colorBy_numeric <- as.integer(as.factor(colorBy)) - 1L
      points <- cbind(points, valueA = colorBy_numeric)

      options$colorBy <- "valueA"
      options$pointColor <- hex_colors
      
      legend_data$names <- levels
      legend_data$colors <- hex_colors
      legend_data$var_type <- var_type
      
    } else if (is.numeric(colorBy)) {
      var_type <- "continuous"
      
      colorBy_normalized <- (colorBy - min(colorBy, na.rm = TRUE)) / (max(colorBy, na.rm = TRUE) - min(colorBy, na.rm = TRUE))
      points <- cbind(points, valueA = colorBy_normalized)
      
      # Get the viridisLite function based on the palette string.
      palette_func <- switch(continuous_palette,
                             viridis = viridisLite::viridis,
                             magma = viridisLite::magma,
                             plasma = viridisLite::plasma,
                             inferno = viridisLite::inferno,
                             viridisLite::viridis)
      palette_colors <- palette_func(256)
      
      # Remove the alpha channel if present.
      palette_hex6 <- substr(palette_colors, 1, 7)
      
      options$colorBy <- "valueA"
      options$pointColor <- palette_hex6
      
      legend_data$minVal <- min(colorBy, na.rm = TRUE)
      legend_data$maxVal <- max(colorBy, na.rm = TRUE)
      legend_data$midVal <- mean(colorBy, na.rm = TRUE)
      legend_data$var_type <- var_type
      legend_data$colors <- palette_hex6
      
    } else {
      stop("colorBy must be numeric, character, or factor")
    }
  } else {
    options$pointColor <- "#0072B2"
  }

  widget_spec <- list(
    points = as.matrix(points),
    options = options,
    legend = legend_data,
    x_min = x_min,
    x_max = x_max,
    y_min = y_min,
    y_max = y_max,
    xlab = xlab,
    ylab = ylab,
    showAxes = showAxes,
    showTooltip = showTooltip,
    backgroundColor = backgroundColor
  )

  htmlwidgets::createWidget(
    name = 'my_scatterplot',
    widget_spec,
    width = width,
    height = height,
    package = 'reglScatterplot',
    elementId = elementId
  )
}

#' Shiny bindings for my_scatterplot
#'
#' These functions allow the `my_scatterplot` widget to be used inside Shiny apps.
#'
#' @param outputId Output variable to read from (character).
#' @param width A valid CSS unit for the plot width (e.g., "400px", "100%").
#' @param height A valid CSS unit for the plot height.
#' @param expr An expression that generates a `my_scatterplot` widget.
#' @param env The environment in which to evaluate `expr`.
#' @param quoted Is `expr` a quoted expression (with `quote()`)? 
#'        Default is `FALSE`. Useful when creating wrapper functions.
#'
#' @name my_scatterplot-shiny
#' @export
my_scatterplotOutput <- function(outputId, width = '400px', height = '400px'){
  htmlwidgets::shinyWidgetOutput(outputId, 'my_scatterplot', width, height, package = 'reglScatterplot')
}

#' @rdname my_scatterplot-shiny
#' @export
renderMy_scatterplot <- function(expr, env = parent.frame(), quoted = FALSE) {
  if (!quoted) { expr <- substitute(expr) }
  htmlwidgets::shinyRenderWidget(expr, my_scatterplotOutput, env, quoted = TRUE)
}
