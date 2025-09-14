#' Violin Plot HTML Widget
#'
#' Create an interactive violin plot using D3.js with hover counters and customizable options.
#'
#' @param data data.frame containing the data to plot.
#' @param value column name for the numeric values to plot (required).
#' @param group column name for grouping variable (optional). If NULL, creates single violin.
#' @param colors vector of hex colors for groups. If NULL, uses default D3 color scheme.
#' @param showPoints logical; show individual points overlaid on violins (default TRUE).
#' @param pointSize numeric; size of individual points (default 2).
#' @param logScale logical; use logarithmic y-axis scale (default FALSE).
#' @param legendPosition string; "Legend" to show legend on right, "Bottom" for bottom labels (default "Legend").
#' @param ylab string; y-axis label (default "Value").
#' @param title string; plot title (optional).
#' @param backgroundColor optional hex color for plot background (default white).
#' @param width fixed width of the plot in pixels (default 800).
#' @param height fixed height of the plot in pixels (default 400).
#' @param elementId specify id for the containing div.
#'
#' @import htmlwidgets
#'
#' @examples
#' # Basic violin plot with grouping
#' data(iris)
#' my_violinplot(iris, value = "Sepal.Length", group = "Species")
#' 
#' # Single violin plot without grouping
#' my_violinplot(iris, value = "Petal.Width")
#' 
#' # Custom colors and no points
#' my_violinplot(iris, value = "Sepal.Width", group = "Species", 
#'               colors = c("#FF6B6B", "#4ECDC4", "#45B7D1"),
#'               showPoints = FALSE, pointSize = 3)
#' 
#' # Log scale with bottom labels
#' data(mtcars)
#' my_violinplot(mtcars, value = "mpg", group = "cyl", 
#'               logScale = TRUE, legendPosition = "Bottom",
#'               ylab = "Miles per Gallon", title = "MPG by Cylinders")
#' 
#' @export
my_violinplot <- function(data, value, group = NULL, colors = NULL, 
                         showPoints = TRUE, pointSize = 2, logScale = FALSE,
                         legendPosition = "Legend", ylab = "Value", title = NULL,
                         backgroundColor = NULL, width = 800, height = 400, 
                         elementId = NULL) {
  
  # Validate inputs
  if (missing(data) || missing(value)) {
    stop("Both 'data' and 'value' arguments are required")
  }
  
  if (!is.data.frame(data)) {
    stop("'data' must be a data.frame")
  }
  
  if (!value %in% names(data)) {
    stop(paste("Column", value, "not found in data"))
  }
  
  if (!is.null(group) && !group %in% names(data)) {
    stop(paste("Column", group, "not found in data"))
  }
  
  if (!is.numeric(data[[value]])) {
    stop("Value column must be numeric")
  }
  
  if (logScale && any(data[[value]] <= 0, na.rm = TRUE)) {
    warning("Log scale requested but data contains non-positive values. These will be excluded.")
    data <- data[data[[value]] > 0, ]
  }
  
  # Remove NA values
  if (is.null(group)) {
    data <- data[!is.na(data[[value]]), ]
  } else {
    data <- data[!is.na(data[[value]]) & !is.na(data[[group]]), ]
  }
  
  if (nrow(data) == 0) {
    stop("No valid data points after removing NAs")
  }
  
  # Prepare datasets
  if (is.null(group)) {
    # Single violin
    datasets <- list(
      list(
        values = data[[value]],
        metadata = list(
          name = ylab,
          color = if (!is.null(colors)) colors[1] else NULL
        )
      )
    )
  } else {
    # Grouped violins
    group_levels <- levels(as.factor(data[[group]]))
    datasets <- lapply(group_levels, function(lvl) {
      subset_data <- data[data[[group]] == lvl, ]
      list(
        values = subset_data[[value]],
        metadata = list(
          name = as.character(lvl),
          color = NULL  # Will be set below
        )
      )
    })
    
    # Set colors
    if (!is.null(colors)) {
      if (length(colors) < length(group_levels)) {
        warning("Not enough colors provided. Recycling colors.")
        colors <- rep(colors, length.out = length(group_levels))
      }
      for (i in seq_along(datasets)) {
        datasets[[i]]$metadata$color <- colors[i]
      }
    }
  }
  
  # Validate legendPosition
  if (!legendPosition %in% c("Legend", "Bottom")) {
    legendPosition <- "Legend"
    warning("Invalid legendPosition. Using 'Legend'.")
  }
  
  # Create widget specification
  widget_spec <- list(
    datasets = datasets,
    showPoints = showPoints,
    pointSize = pointSize,
    logScale = logScale,
    legendPosition = legendPosition,
    ylab = ylab,
    title = title,
    backgroundColor = backgroundColor
  )
  
  # Create the widget
  htmlwidgets::createWidget(
    name = 'my_violinplot',
    widget_spec,
    width = width,
    height = height,
    package = 'reglScatterplot',  # You might want to change this to your package name
    elementId = elementId
  )
}

#' Shiny bindings for my_violinplot
#'
#' These functions allow the `my_violinplot` widget to be used inside Shiny apps.
#'
#' @param outputId Output variable to read from (character).
#' @param width A valid CSS unit for the plot width (e.g., "400px", "100%").
#' @param height A valid CSS unit for the plot height.
#' @param expr An expression that generates a `my_violinplot` widget.
#' @param env The environment in which to evaluate `expr`.
#' @param quoted Is `expr` a quoted expression (with `quote()`)? 
#'        Default is `FALSE`. Useful when creating wrapper functions.
#'
#' @name my_violinplot-shiny
#' @export
my_violinplotOutput <- function(outputId, width = '800px', height = '400px') {
  htmlwidgets::shinyWidgetOutput(outputId, 'my_violinplot', width, height, package = 'reglScatterplot')
}

#' @rdname my_violinplot-shiny
#' @export
renderMy_violinplot <- function(expr, env = parent.frame(), quoted = FALSE) {
  if (!quoted) { expr <- substitute(expr) }
  htmlwidgets::shinyRenderWidget(expr, my_violinplotOutput, env, quoted = TRUE)
}
