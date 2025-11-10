#' Scalable scatterplot HTML widget with multi-sync support
#'
#' Create an interactive scalable scatterplot using the `regl-scatterplot` JavaScript library.
#'
#' @param x numeric vector of x coordinates
#' @param y numeric vector of y coordinates
#' @param colorBy factor/chr/numeric vector to color by
#' @param data optional data.frame containing the data
#' @param size point size (default 3)
#' @param categorical_palette RColorBrewer palette name (default "Set1")
#' @param continuous_palette viridisLite palette name (default "viridis")
#' @param custom_palette named character vector of hex colors, e.g. c("Significant" = "#E74C3C", "Not Significant" = "#CCCCCC")
#' @param xlab x-axis label
#' @param ylab y-axis label
#' @param showAxes logical; show axes (default TRUE)
#' @param showTooltip logical; enable tooltips (default TRUE)
#' @param pointColor uniform hex color (overrides colorBy)
#' @param opacity point opacity 0-1 (default 0.8)
#' @param backgroundColor hex color for background
#' @param width canvas width in pixels
#' @param height canvas height in pixels
#' @param legend_title legend title
#' @param enableDownload logical; show download button (default FALSE)
#' @param plotId unique plot ID (for multi-sync)
#' @param syncPlots vector of plot IDs to sync
#' @param elementId container element ID
#' @param gene_names optional vector of gene names for tooltips
#' @param dataVersion Optional unique identifier to force full redraw (advanced)
#' @export
my_scatterplot <- function(x, y, colorBy = NULL, data = NULL, size = 3, 
                           categorical_palette = "Set1", continuous_palette = "viridis", 
                           custom_palette = NULL, gene_names = NULL,
                           xlab = "X", ylab = "Y", 
                           xrange = NULL, yrange = NULL,
                           showAxes = TRUE, showTooltip = TRUE, 
                           pointColor = NULL, opacity = 0.8, backgroundColor = NULL, 
                           width = NULL, height = NULL, legend_title = NULL, 
                           enableDownload = FALSE, plotId = NULL, syncPlots = NULL,
                           elementId = NULL,
                           dataVersion = NULL) {   # ← ADD THIS PARAM
  
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

  # ✅ COMPUTE ORIGINAL DOMAINS - use xrange/yrange if provided
  if (!is.null(xrange)) {
    x_min <- xrange[1]
    x_max <- xrange[2]
  } else {
    x_min <- min(x, na.rm = TRUE)
    x_max <- max(x, na.rm = TRUE)
  }
  
  if (!is.null(yrange)) {
    y_min <- yrange[1]
    y_max <- yrange[2]
  } else {
    y_min <- min(y, na.rm = TRUE)
    y_max <- max(y, na.rm = TRUE)
  }

  # ✅ NORMALIZE COORDINATES TO [-1, 1] using the SPECIFIED ranges
  x_normalized <- -1 + 2 * (x - x_min) / (x_max - x_min)
  y_normalized <- -1 + 2 * (y - y_min) / (y_max - y_min)
  
  # ✅ CLAMP normalized values to [-1, 1] (in case capping wasn't perfect)
  x_normalized <- pmax(-1, pmin(1, x_normalized))
  y_normalized <- pmax(-1, pmin(1, y_normalized))
  
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
      
      cat("[my_scatterplot] Processing categorical colorBy\n")
      cat("[my_scatterplot] Levels:", paste(levels, collapse = ", "), "\n")
      
      # Use custom_palette if provided
      if (!is.null(custom_palette)) {
        cat("[my_scatterplot] custom_palette provided\n")
        cat("[my_scatterplot] custom_palette names:", paste(names(custom_palette), collapse = ", "), "\n")
        cat("[my_scatterplot] custom_palette values:", paste(custom_palette, collapse = ", "), "\n")
        
        if (!is.null(names(custom_palette))) {
          # Build plot_colors by matching levels to named palette
          plot_colors <- character(length(levels))
          
          for (i in seq_along(levels)) {
            level_name <- levels[i]
            if (level_name %in% names(custom_palette)) {
              plot_colors[i] <- custom_palette[[level_name]]
              cat("[my_scatterplot] Mapped", level_name, "to", plot_colors[i], "\n")
            } else {
              warning(paste("Level", level_name, "not found in custom_palette"))
              plot_colors[i] <- custom_palette[1]
            }
          }
        } else {
          warning("custom_palette must be a named vector")
          plot_colors <- as.character(custom_palette[1:length(levels)])
        }
      } else {
        # Use RColorBrewer
        cat("[my_scatterplot] Using RColorBrewer palette:", categorical_palette, "\n")
        plot_colors <- RColorBrewer::brewer.pal(min(length(levels), 11), categorical_palette)
        if (length(levels) > 11) {
          plot_colors <- colorRampPalette(plot_colors)(length(levels))
        }
      }
      
      cat("[my_scatterplot] Final plot_colors:", paste(plot_colors, collapse = ", "), "\n")
      
      # Convert to proper hex format
      hex_colors <- character(length(plot_colors))
      for (i in seq_along(plot_colors)) {
        col <- plot_colors[i]
        # Check if already hex
        if (grepl("^#", col)) {
          hex_colors[i] <- col
        } else {
          # Convert RGB/named color to hex
          rgb_vals <- col2rgb(col)
          hex_colors[i] <- rgb(rgb_vals[1], rgb_vals[2], rgb_vals[3], maxColorValue = 255)
        }
      }
      
      cat("[my_scatterplot] Final hex_colors:", paste(hex_colors, collapse = ", "), "\n")
      
      colorBy_numeric <- as.integer(as.factor(colorBy)) - 1L
      points <- cbind(points, valueA = colorBy_numeric)

      options$colorBy <- "valueA"
      options$pointColor <- hex_colors
      
      legend_data$names <- levels
      legend_data$colors <- hex_colors
      legend_data$var_type <- var_type
      legend_data$title <- legend_title
      
    } else if (is.numeric(colorBy)) {
      var_type <- "continuous"
      
      colorBy_normalized <- (colorBy - min(colorBy, na.rm = TRUE)) / (max(colorBy, na.rm = TRUE) - min(colorBy, na.rm = TRUE))
      points <- cbind(points, valueA = colorBy_normalized)
      
      palette_func <- switch(continuous_palette,
                             viridis = viridisLite::viridis,
                             magma = viridisLite::magma,
                             plasma = viridisLite::plasma,
                             inferno = viridisLite::inferno,
                             viridisLite::viridis)
      palette_colors <- palette_func(256)
      palette_hex6 <- substr(palette_colors, 1, 7)
      
      options$colorBy <- "valueA"
      options$pointColor <- palette_hex6
      
      legend_data$minVal <- min(colorBy, na.rm = TRUE)
      legend_data$maxVal <- max(colorBy, na.rm = TRUE)
      legend_data$midVal <- mean(colorBy, na.rm = TRUE)
      legend_data$var_type <- var_type
      legend_data$colors <- palette_hex6
      legend_data$title <- legend_title %||% "Value"
      
    } else {
      stop("colorBy must be numeric, character, or factor")
    }
  } else {
    options$pointColor <- "#0072B2"
  }

  # ✅ FIX: Ensure gene_names is properly formatted
  gene_names_list <- NULL
  if (!is.null(gene_names)) {
    # Convert to character vector and ensure it's serializable
    gene_names_list <- as.character(gene_names)
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
    backgroundColor = backgroundColor,
    enableDownload = enableDownload,
    gene_names = gene_names_list,
    plotId = plotId,
    syncPlots = syncPlots,
    dataVersion = dataVersion   # ← ADD THIS LINE
  )

  if (is.null(elementId) && !is.null(plotId)) {
    elementId <- plotId
  }
  
  widget <- htmlwidgets::createWidget(
    name = 'my_scatterplot',
    widget_spec,
    width = width,
    height = height,
    package = 'reglScatterplot',
    elementId = elementId
  )
  
  widget
}

# Shiny bindings
#' @export
my_scatterplotOutput <- function(outputId, width = '400px', height = '400px'){
  htmlwidgets::shinyWidgetOutput(outputId, 'my_scatterplot', width, height, package = 'reglScatterplot')
}

#' @export
renderMy_scatterplot <- function(expr, env = parent.frame(), quoted = FALSE) {
  if (!quoted) { expr <- substitute(expr) }
  htmlwidgets::shinyRenderWidget(expr, my_scatterplotOutput, env, quoted = TRUE)
}

#' @export
enableMyScatterplotSync <- function(plotIds, session = shiny::getDefaultReactiveDomain()) {
  session$sendCustomMessage("my_scatterplot_enableSync", list(plotIds = plotIds))
}

NULL