# Media to capture for the README

Drop the files in `man/figures/` with these exact names (the README already links
to them, and `man/figures/` ships with the package so they show on the
Bioconductor/pkgdown pages too). Use the bundled dataset so they're reproducible:

```r
library(reglScatterplotR)
data(reglScatterExample)   # UMAP_1/UMAP_2, celltype column, CD3D etc.
```

## Stills (PNG)

| File | What to show | How |
|------|--------------|-----|
| `man/figures/umap-categorical.png` | UMAP coloured by `celltype`, **frosted legend visible** in a corner | `reglScatterplot(reglScatterExample, x="UMAP_1", y="UMAP_2", colorBy="celltype")` |
| `man/figures/umap-continuous.png` | Same UMAP coloured by a gene, **colour bar visible** | `reglScatterplot(reglScatterExample, x="UMAP_1", y="UMAP_2", colorBy="CD3D", continuousPalette="viridis", vmax="p99")` |
| `man/figures/filter-sliders.png` | The `filterBy` panel: a histogram with the dual-handle range brush, some points dimmed | add `filterBy = "score"` (or any numeric col) and drag a handle in |
| `man/figures/linked-grid.png` | Two plots side by side, one zoomed (to prove `syncPlots` linked the camera) | give both plots the same `syncPlots = "g"`, lay out in an R Markdown chunk or `htmltools::tagList` |

Capture the canvas region only (not the RStudio/browser chrome). ~1400 px wide;
PNG, not JPG, so points stay crisp. The widget's own toolbar screenshot button
(or `pixelRatio = 3`) gives an export-quality grab.

## Hero animation (GIF)

`man/figures/demo.gif` — one ~8–12 s clip, in this order:

1. Pan and zoom (scroll) around the UMAP.
2. Drag the legend to another corner, then click a category to filter it out;
   shift-click a second to extend.
3. Switch to the lasso tool and circle a cluster.

Keep it short and loopable. Target ≤ ~4 MB.

### Recording → GIF (Linux/Wayland)

```bash
wf-recorder -g "$(slurp)" -f demo.mp4        # record the plot area
ffmpeg -i demo.mp4 -vf "fps=12,scale=760:-1:flags=lanczos,palettegen" -y pal.png
ffmpeg -i demo.mp4 -i pal.png -lavfi "fps=12,scale=760:-1:flags=lanczos[x];[x][1:v]paletteuse" -y man/figures/demo.gif
```
