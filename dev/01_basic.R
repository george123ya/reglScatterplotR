## dev/01_basic.R - smoke test.
## devtools::load_all() then source().

library(reglScatterplot)

w <- reglScatterplot(
    iris,
    x = "Sepal.Length", y = "Sepal.Width",
    colorBy = "Species",
    legendPosition = "top-right",
    height = 500   # width auto-fills the Viewer / cell output
)
print(w)   # Viewer pane / cell output.

## Save standalone, open in Chromium.
path <- tempfile(fileext = ".html")
htmlwidgets::saveWidget(w, path, selfcontained = TRUE)
cat("→ ", path, "\n")
browseURL(path)
