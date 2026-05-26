# Recipes

Self-contained snippets you can paste into an R session.

## Single-cell UMAP coloured by cluster

```r
library(SingleCellExperiment)
library(reglScatterplotR)

# Assume `sce` already has reducedDim(sce, "UMAP") and colData(sce)$cluster
reglScatterplot(sce, x = "UMAP", colorBy = "cluster")
```

## UMAP coloured by gene expression

`colorBy` matches a row name → values come from `assay(sce, "logcounts")`
by default. Use the `assay` argument to switch to a different slot.

```r
reglScatterplot(sce, x = "UMAP", colorBy = "MS4A1")
reglScatterplot(sce, x = "UMAP", colorBy = "MS4A1", assay = "counts")
```

## Spatial tissue map

```r
library(SpatialExperiment)
reglScatterplot(spe, x = "spatial", colorBy = "celltype",
                autoFit = TRUE)            # preserves tissue aspect
```

## Diverging fold-change scatter

`centerZero = TRUE` forces a symmetric scale around 0 so positive and
negative log-fold-changes are mapped to opposite ends of the palette.

```r
reglScatterplot(de_results, x = "logCPM", y = "logFC",
                colorBy = "logFC",
                continuousPalette = "magma",
                centerZero = TRUE,
                vmin = "p1", vmax = "p99")
```

## Linked plots in Shiny

```r
library(shiny)
library(reglScatterplotR)

ui <- fluidPage(
    fluidRow(
        column(6, reglScatterplotOutput("p1")),
        column(6, reglScatterplotOutput("p2"))
    ),
    actionButton("link", "Link cameras")
)

server <- function(input, output, session) {
    output$p1 <- renderReglScatterplot({
        reglScatterplot(df, x = "x", y = "y", colorBy = "cluster",
                        plotId = "p1")
    })
    output$p2 <- renderReglScatterplot({
        reglScatterplot(df, x = "x", y = "y", colorBy = "score",
                        plotId = "p2")
    })
    observeEvent(input$link, {
        enableReglScatterplotSync(c("p1", "p2"))
    })
}

shinyApp(ui, server)
```

## Custom categorical palette

```r
mypal <- c("#1b9e77", "#d95f02", "#7570b3", "#e7298a",
           "#66a61e", "#e6ab02", "#a6761d", "#666666")

reglScatterplot(sce, x = "UMAP", colorBy = "cluster",
                customPalette = mypal)
```

To map specific names to specific colours (instead of positional matching):

```r
named <- c(B_cell = "#d62728", T_cell = "#1f77b4", NK = "#2ca02c")
reglScatterplot(sce, x = "UMAP", colorBy = "celltype",
                customColors = named)
```

## Filtered subsets via row indices

When `filteredIndices` is supplied the widget hides points whose row index
isn't in the vector. Useful for QC-style filtering.

```r
keep <- which(colData(sce)$pct_mito < 20)
reglScatterplot(sce, x = "UMAP", colorBy = "cluster",
                filteredIndices = keep - 1L)   # 0-based, like JavaScript
```

## Saving to a standalone HTML

```r
w <- reglScatterplot(sce, x = "UMAP", colorBy = "cluster")
htmlwidgets::saveWidget(w, "umap.html", selfcontained = TRUE)
```

Use `selfcontained = FALSE` when the file is large (> 50 MB) — it writes
the JS to a sibling directory rather than inlining, which keeps the HTML
small and parseable.
