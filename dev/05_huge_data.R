## dev/05_huge_data.R - 10 M point stress test.
## Run this only when you've got ~4 GB of free RAM.

library(reglScatterplotR)

N <- as.integer(10e6)
cat(sprintf("Generating %s points...\n", format(N, big.mark = ",")))

set.seed(1L)
df <- data.frame(
    x = rnorm(N),
    y = rnorm(N),
    v = runif(N)
)

cat("Building widget (settings tuned for size, not quality)...\n")
t0 <- Sys.time()
w <- reglScatterplot(
    df, x = "x", y = "y", colorBy = "v",
    pointSize = 1, opacity = 1,
    showAxes = FALSE,
    showTooltip = FALSE,
    enableDownload = FALSE,
    pointLabels = NULL,
    width = 1400, height = 900
)
cat(sprintf("  build: %.2fs\n", as.numeric(Sys.time() - t0, units = "secs")))

t1 <- Sys.time()
path <- "/tmp/regl_10M.html"
htmlwidgets::saveWidget(w, path, selfcontained = TRUE)
cat(sprintf("  save : %.2fs\n", as.numeric(Sys.time() - t1, units = "secs")))
cat(sprintf("  file : %.1f MB\n", file.info(path)$size / 1024 / 1024))
cat(sprintf("→ %s\n", path))

## Optionally open it - heavy.
options(browser = "chromium")
browseURL(path)
