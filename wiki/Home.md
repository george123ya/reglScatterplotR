# reglScatterplot wiki

Welcome. This wiki collects the recipes that are too long for the README
and too narrative for the man pages.

## Pages

* **[Recipes](Recipes)** — copy-paste examples for common biology tasks
  (UMAP, spatial, fold-change, linked plots).
* **[Troubleshooting](Troubleshooting)** — known issues and workarounds:
  blank cell in Jupyter, clipping in small viewports, file:// CORS,
  RStudio Viewer font.
* **[Performance tips](Performance-tips)** — sizing, quantisation,
  memory ceilings, when to reach for tiles.
* **[Roadmap](Roadmap)** — what's planned next and what's explicitly
  out of scope.

## Quick start

```r
library(reglScatterplot)
reglScatterplot(iris, x = "Sepal.Length", y = "Sepal.Width",
                colorBy = "Species")
```

For broader documentation see the package vignettes
(`vignette("reglScatterplot")`) and the function reference
(`?reglScatterplot`).
