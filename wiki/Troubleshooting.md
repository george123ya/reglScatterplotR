# Troubleshooting

## Blank cell output in VSCode Jupyter

**Symptom:** the cell runs, no error, but no plot appears. Sometimes a
`SyntaxError: Unterminated string in JSON ...` in the developer console.

**Cause(s):**

1. Missing rendering deps in the kernel: `htmltools`, `repr`, `IRdisplay`.
2. HTMLWidgets bootstrap missed `DOMContentLoaded` in the cell iframe.
3. CDN (`esm.sh`) blocked.

**Fix:**

```r
install.packages(c("htmltools", "repr", "IRdisplay"))
```

Then *Restart Kernel* (Soft Reload won't refresh the JS). The widget
re-triggers `HTMLWidgets.staticRender()` itself on script load, so this
usually just works once the deps are in place.

## Edge clipping at small viewports

**Symptom:** clusters near the data extremes look slightly cut off,
especially when the host window is narrow.

**Cause:** the widget normalises data to `[-1, 1]` and regl-scatterplot
applies a small internal pixel margin. In tiny viewports that pixel
margin is a bigger fraction of the visible range.

**Fix:** increase the padding around the data range.

```r
reglScatterplot(..., rangePadding = 0.2)   # 20% on each side
```

Default is 15%. Bump to 20-30% for very tight layouts. Use `0` to draw
exactly the data range.

## `'file:' URLs are treated as unique security origins`

**Symptom:** when opening a saved HTML directly in Chromium, console
shows the above message and the plot doesn't render.

**Cause:** the regl-scatterplot ES module is dynamically imported from a
CDN; Chromium blocks cross-origin loads from `file://` pages by default.

**Fixes (any one):**

```fish
# A. Serve via a local HTTP server
cd /tmp && python -m http.server 8000 &
chromium http://localhost:8000/yourwidget.html

# B. Launch Chromium with file access allowed
chromium --allow-file-access-from-files /tmp/yourwidget.html
```

```r
# C. R-side: default browser uses the flag
options(browser = function(url)
    system2("chromium", c("--allow-file-access-from-files", shQuote(url)),
            wait = FALSE))
```

## `height = "100%"` collapses to nothing

**Symptom:** widget is invisible (zero height) inside a standalone HTML
opened in a browser.

**Cause:** the saved HTML doesn't set `html { height: 100% }` on its
own, so `100%` of an unsized parent is 0.

**Fix:** use a pixel height.

```r
reglScatterplot(df, x = "x", y = "y", height = 500)
```

If you genuinely want to fill the viewport, write a small style block
into the saved HTML after `saveWidget()`:

```r
htmlwidgets::saveWidget(w, "p.html", selfcontained = TRUE)
html <- readLines("p.html")
html <- sub("</head>",
            "<style>html,body,.html-widget{height:100vh;margin:0}</style></head>",
            html, fixed = TRUE)
writeLines(html, "p.html")
```

## RStudio Viewer renders Times Roman instead of sans-serif

**Cause:** RStudio's Qt webview defaults to a serif when no font is
explicitly named in CSS.

**Fix:** already in the widget — every text element pins a sans-serif
family with `!important`. If you still see serif, it's likely a stale
install:

```r
remove.packages("reglScatterplot")
.rs.restartR()
devtools::install()
```

## Download button missing in RStudio Viewer / Jupyter

**Cause:** intentional. The download button does not work reliably from
inside IDE iframes (sandboxed downloads, blocked image rendering), so
it's hidden when the widget detects it's running in one.

**Fix:** to enable in those contexts, pass `enableDownload = TRUE` —
even then the button is still hidden in IDE iframes by design. View the
saved HTML in a real browser if you need it.

## `lazy-load database '.../reglScatterplot.rdb' is corrupt`

**Cause:** `remove.packages()` was run while another R session still had
the package loaded.

**Fix (from a shell, with all R sessions closed):**

```fish
rm -rf ~/R/library/reglScatterplot
cd ~/Desktop/reglScatterplotR
R --vanilla -e 'devtools::install()'
```
