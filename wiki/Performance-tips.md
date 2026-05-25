# Performance tips

Most of this also lives in the package vignette
(`vignette("performance")`); this page is a shorter cheat-sheet.

## Scale ladder

| Point count       | Status                       | Notes                                               |
|------------------:|------------------------------|-----------------------------------------------------|
| ≤ 500 k           | Flawless                     | Below the auto performance-mode threshold           |
| 500 k - 5 M       | Smooth                       | `performanceMode` kicks in automatically            |
| 5 M - 20 M        | Usable                       | Tighten settings (see below)                        |
| 20 M - 100 M      | Standalone HTML reaches RAM ceiling | Tile-based architectures start to win        |
| > 100 M           | Out of reach in-browser      | Server-side rendering / WebGPU territory            |

## Levers for huge data

```r
reglScatterplot(
    big_df, x = "x", y = "y",
    pointSize = 1,           # one pixel per point
    opacity = 1,             # no alpha blending
    showAxes = FALSE,        # drops the D3 axis layer
    showTooltip = FALSE,     # no per-point hit-test
    enableDownload = FALSE,
    pointLabels = NULL       # don't ship gene names
)
```

These collectively cut memory by ~30% and improve frame rates at the
millions-of-points end.

## Encoding

* X / Y coordinates: Uint16 quantised, 2 bytes / point
* Continuous colour: Uint16 (in [0, 1]), 2 bytes / point
* Categorical colour: Uint16 (integer index), 2 bytes / point
* Filter ranges: Float32, 4 bytes / point

A 1 M-point single-cell UMAP normally fits in ~10 MB of HTML.

## Browser memory budget

Roughly:

* R-side at build: ~`n × 40 bytes`
* Serialized payload: ~`n × 16 bytes`
* JS heap in the page: ~`n × 32 bytes`
* WebGL / VRAM: ~`n × 50 bytes`

10 M points → ~1.4 GB total. Chrome's default per-tab JS heap ceiling is
about 2 GB, so 10 M is near the wall.

## When to stop using the standalone HTML path

If you're routinely loading > 10 M points, switch to a tile
architecture (deepscatter or similar). The pattern: precompute spatial
tiles on disk once, viewer only loads what's in view.
