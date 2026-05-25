## ----------------------------------------------------------------------------
## Shiny bindings and runtime helpers
## ----------------------------------------------------------------------------

#' Shiny bindings for reglScatterplot
#'
#' Output and render functions for using `reglScatterplot()` inside Shiny
#' applications and interactive R Markdown documents.
#'
#' @param outputId Output variable name (character).
#' @param width,height CSS unit (e.g. `"100%"`, `"600px"`).
#' @param expr An expression that produces a `reglScatterplot` widget.
#' @param env Environment in which to evaluate `expr`.
#' @param quoted Is `expr` already quoted? Default `FALSE`.
#'
#' @return `reglScatterplotOutput()` returns a Shiny output element;
#'   `renderReglScatterplot()` returns a render function.
#'
#' @examples
#' if (interactive()) {
#'   ui <- shiny::fluidPage(reglScatterplotOutput("plot"))
#'   server <- function(input, output, session) {
#'     output$plot <- renderReglScatterplot({
#'       reglScatterplot(iris, x = "Sepal.Length", y = "Sepal.Width",
#'                       colorBy = "Species")
#'     })
#'   }
#'   shiny::shinyApp(ui, server)
#' }
#'
#' @name reglScatterplot-shiny
#' @export
reglScatterplotOutput <- function(outputId, width = "100%", height = "600px") {
    htmlwidgets::shinyWidgetOutput(outputId, "reglScatterplot",
                                   width, height,
                                   package = "reglScatterplot")
}

#' @rdname reglScatterplot-shiny
#' @export
renderReglScatterplot <- function(expr, env = parent.frame(), quoted = FALSE) {
    if (!quoted) expr <- substitute(expr)
    htmlwidgets::shinyRenderWidget(expr, reglScatterplotOutput, env,
                                   quoted = TRUE)
}

#' Link the camera of multiple scatterplots
#'
#' Enables (or disables) synchronised pan/zoom across the `reglScatterplot`
#' widgets identified by `plotIds`. Must be called from inside a Shiny
#' reactive context.
#'
#' @param plotIds Character vector of `plotId` strings.
#' @param enabled Logical; `TRUE` to enable sync, `FALSE` to disable.
#' @param session Shiny session object (defaults to the active one).
#' @return Invisibly `NULL`. Called for its side effect of sending a custom
#'   message to the browser.
#' @examples
#' if (interactive()) {
#'   enableReglScatterplotSync(c("plotA", "plotB"))
#' }
#' @export
enableReglScatterplotSync <- function(plotIds, enabled = TRUE,
                                      session = shiny::getDefaultReactiveDomain()) {
    if (is.null(session)) {
        stop("`enableReglScatterplotSync()` must be called inside a Shiny session.",
             call. = FALSE)
    }
    session$sendCustomMessage("my_scatterplot_sync",
                              list(plotIds = plotIds, enabled = enabled))
    invisible(NULL)
}

#' Update the point size of one or more scatterplots
#'
#' @param plotIds Character vector of plot ids whose size should be updated.
#' @param size Numeric pixel size.
#' @param session Shiny session.
#' @return Invisibly `NULL`.
#' @examples
#' if (interactive()) {
#'   updateReglPointSize("plotA", size = 5)
#' }
#' @export
updateReglPointSize <- function(plotIds, size,
                                session = shiny::getDefaultReactiveDomain()) {
    if (is.null(session)) {
        stop("`updateReglPointSize()` must be called inside a Shiny session.",
             call. = FALSE)
    }
    for (id in plotIds) {
        session$sendCustomMessage("update_point_size",
                                  list(plotId = id, size = size))
    }
    invisible(NULL)
}
