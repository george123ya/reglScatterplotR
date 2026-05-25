#' reglScatterplot: Interactive WebGL Scatterplots for R
#'
#' Lightweight `htmlwidgets` interface to the JavaScript
#' `regl-scatterplot` library, rendering millions of points in the browser via
#' WebGL. Designed for exploratory visualisation of single-cell, spatial and
#' other high-dimensional biological data, with synchronised pan/zoom across
#' multiple plots, categorical and continuous colour mapping, lasso selection
#' and PNG/SVG/PDF export.
#'
#' @section Main functions:
#' * [reglScatterplot()] - create a scatterplot widget.
#' * [enableReglScatterplotSync()] - link the camera of multiple plots.
#' * [updateReglPointSize()] - resize points after rendering.
#'
#' @section Rendering contexts:
#' The widget renders in RStudio's Viewer pane, in standalone HTML files,
#' inside Shiny apps and inside Jupyter notebooks running the IRkernel (e.g.
#' VSCode's Jupyter extension). Outside of Shiny the JavaScript dependencies
#' are pulled from a CDN on first use.
#'
#' @keywords internal
"_PACKAGE"
