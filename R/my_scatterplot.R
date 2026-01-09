library(shiny)
library(htmlwidgets)
library(base64enc) 

#' @export
`%||%` <- function(x, y) {
  if (is.null(x)) y else x
}

#' @export
to_base64 <- function(vec) {
  if (is.null(vec)) return(NULL)
  con <- rawConnection(raw(0), "r+")
  writeBin(as.numeric(vec), con, size = 4)
  raw_data <- rawConnectionValue(con)
  close(con)
  paste0("base64:", base64enc::base64encode(raw_data))
}

parse_limit <- function(limit_arg, data_vec, default_fn) {
  if (is.null(limit_arg)) return(default_fn(data_vec, na.rm = TRUE))
  
  val <- if (is.character(limit_arg)) {
    # Handle "p99", "p95", "min", "max"
    if (grepl("^p[0-9]+(\\.[0-9]+)?$", limit_arg)) {
      p <- as.numeric(sub("p", "", limit_arg)) / 100
      quantile(data_vec, probs = p, na.rm = TRUE)
    } else if (limit_arg == "min") {
      min(data_vec, na.rm = TRUE)
    } else if (limit_arg == "max") {
      max(data_vec, na.rm = TRUE)
    } else {
      # Fallback for "max" if passed as string literal from UI
      default_fn(data_vec, na.rm = TRUE) 
    }
  } else {
    as.numeric(limit_arg)
  }

  return(as.numeric(unname(val)))
}

#' @export
my_scatterplot <- function(data = NULL, x, y, 
                           colorBy = NULL, 
                           group_var = NULL,
                           filter_vars = NULL, 
                           size = NULL, 
                           categorical_palette = "Set1", 
                           continuous_palette = "viridis", 
                           custom_palette = NULL, 
                           custom_colors = NULL,
                           gene_names = NULL,
                           xlab = "X", ylab = "Y", 
                           xrange = NULL, yrange = NULL,
                           # --- NEW SCALING ARGUMENTS ---
                           vmin = NULL,           # e.g., "p01", 0, or NULL (auto)
                           vmax = NULL,           # e.g., "p99", 5, or NULL (auto)
                           center_zero = FALSE,   # If TRUE, forces scale to be symmetric around 0 (-x to +x)
                           # -----------------------------
                           showAxes = TRUE, showTooltip = TRUE, 
                           pointColor = NULL, opacity = NULL, backgroundColor = NULL, 
                           axisColor = "#333333", 
                           legendBg = "#ffffff",  
                           legendText = "#000000",
                           width = NULL, height = NULL, legend_title = NULL, title = NULL,
                           enableDownload = TRUE, plotId = NULL, syncPlots = NULL,
                           elementId = NULL,
                           dataVersion = NULL,
                           masterId = NULL,
                           autoFit = FALSE,
                           margins = NULL,
                           fontSize = 12,
                           legendFontSize = 12,
                           filtered_indices = NULL, 
                           selected_indices = NULL,
                           syncState = TRUE 
                           ) {

  # --- DATA EXTRACTION ---
  if (!is.null(data)) {
    x_vec <- data[, x]
    y_vec <- data[, y]
    if (!is.null(colorBy)) color_vec <- data[, colorBy] else color_vec <- NULL
    
    if (!is.null(group_var) && group_var %in% names(data)) {
      group_vec <- data[, group_var]
    } else {
      group_vec <- group_var
    }
  } else {
    x_vec <- x
    y_vec <- y
    color_vec <- colorBy
    group_vec <- group_var
  }

  x_vec <- as.numeric(unname(x_vec))
  y_vec <- as.numeric(unname(y_vec))
  n_points <- length(x_vec)
  
  # --- AUTO-PERFORMANCE ---
  performance_mode <- FALSE
  if (n_points > 500000) {
    performance_mode <- TRUE
    if (is.null(size)) size <- 1 
    if (!is.null(gene_names)) gene_names <- NULL 
    if (is.null(opacity)) opacity <- 1.0 
  } else {
    if (is.null(size)) size <- 3
    if (is.null(opacity)) opacity <- 0.8
  }
  
  # NORMALIZE COORDINATES (X/Y)
  if (!is.null(xrange)) { xmin <- xrange[1]; xmax <- xrange[2] } 
  else { xmin <- min(x_vec, na.rm=TRUE); xmax <- max(x_vec, na.rm=TRUE) }
  
  if (!is.null(yrange)) { ymin <- yrange[1]; ymax <- yrange[2] } 
  else { ymin <- min(y_vec, na.rm=TRUE); ymax <- max(y_vec, na.rm=TRUE) }

  x_norm <- -1 + 2 * (x_vec - xmin) / (xmax - xmin)
  y_norm <- -1 + 2 * (y_vec - ymin) / (ymax - ymin)
  x_norm <- pmax(-1, pmin(1, x_norm))
  y_norm <- pmax(-1, pmin(1, y_norm))
  
  z_norm <- NULL
  options <- list(size = size, opacity = opacity)
  legend_data <- list()
  
  color_var_name <- if(!is.null(colorBy) && is.character(colorBy) && length(colorBy)==1) colorBy else "Solid_Color"
  group_var_name <- if(!is.null(group_var) && is.character(group_var) && length(group_var)==1) group_var else NULL
  
  # --- COLOR LOGIC ---
  if (!is.null(pointColor)) {
    options$pointColor <- pointColor
    options$colorBy <- NULL 
  } else if (!is.null(color_vec)) {
    if (is.character(color_vec) || is.factor(color_vec)) {
      # === CATEGORICAL ===
      var_type <- "categorical"
      levels <- levels(as.factor(color_vec))
      
      # [Palette selection logic same as before...]
      if (!is.null(custom_colors) && length(custom_colors) > 0) {
        cols <- unname(custom_colors[levels])
        if (any(is.na(cols))) {
          fallback_cols <- RColorBrewer::brewer.pal(min(length(levels), 11), categorical_palette)
          if(length(levels) > 11) fallback_cols <- colorRampPalette(fallback_cols)(length(levels))
          cols[is.na(cols)] <- fallback_cols[is.na(cols)]
        }
      } else if (!is.null(custom_palette)) {
          cols <- if (!is.null(names(custom_palette))) custom_palette[levels] else custom_palette[1:length(levels)]
      } else {
          cols <- RColorBrewer::brewer.pal(min(length(levels), 11), categorical_palette)
          if (length(levels) > 11) cols <- colorRampPalette(cols)(length(levels))
      }
      cols[is.na(cols)] <- "#808080"
      
      hex_cols <- sapply(cols, function(c) {
        if (grepl("^#", c)) c else rgb(t(col2rgb(c)), maxColorValue=255)
      })
      
      z_norm <- as.integer(as.factor(color_vec)) - 1L
      options$colorBy <- "valueA" 
      options$pointColor <- as.vector(hex_cols)

      legend_data <- list(
        names = I(levels),             
        colors = I(as.vector(hex_cols)),
        var_type = var_type, 
        title = legend_title,
        var_name = color_var_name
      )
      
    } else if (is.numeric(color_vec)) {
      # === CONTINUOUS (UPDATED FOR VMAX/VMIN) ===
      var_type <- "continuous"
      
      # 1. Determine Limits
      c_min <- parse_limit(vmin, color_vec, min)
      c_max <- parse_limit(vmax, color_vec, max)

      # 2. Handle Symmetry (e.g. for Z-scores)
      if (center_zero) {
        abs_lim <- max(abs(c_min), abs(c_max))
        c_min <- -abs_lim
        c_max <- abs_lim
      }
      
      # 3. Clip Data (This fixes the "One point makes everything purple" issue)
      # We create a clipped copy just for normalization
      color_vec_clipped <- pmax(c_min, pmin(c_max, color_vec))
      
      # 4. Normalize to [0, 1] for WebGL
      # Avoid division by zero if all values are same
      rng_diff <- c_max - c_min
      if (rng_diff == 0) rng_diff <- 1
      
      z_norm <- (color_vec_clipped - c_min) / rng_diff
      
      p_func <- switch(continuous_palette,
                       viridis = viridisLite::viridis,
                       magma = viridisLite::magma,
                       plasma = viridisLite::plasma,
                       inferno = viridisLite::inferno,
                       cividis = viridisLite::cividis,
                       turbo = viridisLite::turbo,
                       viridisLite::viridis)
      p_hex <- substr(p_func(256), 1, 7)
      
      options$colorBy <- "valueA"
      options$pointColor <- p_hex
      
      # Send the USED min/max to the legend so it displays correctly
      legend_data <- list(
        minVal = c_min, 
        maxVal = c_max, 
        midVal = (c_min + c_max) / 2, 
        var_type = var_type, 
        colors = p_hex, 
        title = legend_title %||% "Value",
        var_name = color_var_name
      )
    }
  } else {
    options$pointColor <- "#0072B2"
    options$colorBy <- NULL
  }

  # --- FILTERS ---
  filter_payload <- list()
  if (!is.null(filter_vars) && is.data.frame(filter_vars)) {
      for(col in names(filter_vars)) {
          val <- as.numeric(filter_vars[[col]])
          filter_payload[[col]] <- to_base64(val)
      }
  }
  
  group_payload <- NULL
  if (!is.null(group_vec)) {
      g_vals <- as.integer(as.factor(group_vec)) - 1L
      group_payload <- to_base64(g_vals)
  }

  if (is.null(margins)) {
    margins <- list(top = 20, right = 20, bottom = 40, left = 50)
  }

  init_server_indices <- NULL
  if (!is.null(filtered_indices)) {
    init_server_indices <- as.integer(filtered_indices) 
  }
  
  init_selected_indices <- NULL
  if (!is.null(selected_indices)) {
    init_selected_indices <- as.integer(selected_indices) 
  }

  widget_spec <- list(
    x = to_base64(x_norm), 
    y = to_base64(y_norm),
    z = to_base64(z_norm),
    filter_data = filter_payload, 
    group_data = group_payload,
    n_points = n_points,
    options = options,
    legend = legend_data,
    x_min = xmin, x_max = xmax,
    y_min = ymin, y_max = ymax,
    xlab = xlab, ylab = ylab,
    showAxes = showAxes, showTooltip = showTooltip,
    backgroundColor = backgroundColor,
    axisColor = axisColor,
    legendBg = legendBg,       
    legendText = legendText,   
    enableDownload = enableDownload,
    gene_names = if(!is.null(gene_names)) as.character(gene_names) else NULL,
    plotId = plotId, syncPlots = syncPlots,
    dataVersion = dataVersion,
    performanceMode = performance_mode,
    masterId = masterId,
    autoFit = autoFit,
    margins = margins,
    fontSize = fontSize,
    legendFontSize = legendFontSize,
    init_server_indices = init_server_indices,
    init_selected_indices = init_selected_indices,
    syncState = syncState,
    colorVar = color_var_name,
    groupVar = group_var_name
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

#' @export
my_scatterplotOutput <- function(outputId, width = '100%', height = '600px'){
  htmlwidgets::shinyWidgetOutput(outputId, 'my_scatterplot', width, height, package = 'reglScatterplot')
}

#' @export
renderMy_scatterplot <- function(expr, env = parent.frame(), quoted = FALSE) {
  if (!quoted) { expr <- substitute(expr) }
  htmlwidgets::shinyRenderWidget(expr, my_scatterplotOutput, env, quoted = TRUE)
}

#' @export
enableMyScatterplotSync <- function(plotIds, enabled = TRUE, session = shiny::getDefaultReactiveDomain()) {
  session$sendCustomMessage("my_scatterplot_sync", list(plotIds = plotIds, enabled = enabled))
}

#' @export
updateMyScatterplotSize <- function(plotIds, size, session = shiny::getDefaultReactiveDomain()) {
  for(id in plotIds) {
    session$sendCustomMessage("update_point_size", list(plotId = id, size = size))
  }
}