## dev/06_compare_libs.R - fair comparison: total HTML build time + size.

library(reglScatterplotR)

bench_compare_fair <- function(n) {
    df <- data.frame(x = rnorm(n), y = rnorm(n), v = runif(n))

    measure <- function(build_expr, label) {
        t0 <- Sys.time()
        w <- eval(build_expr)
        path <- tempfile(fileext = ".html")
        htmlwidgets::saveWidget(w, path, selfcontained = TRUE)
        t1 <- Sys.time()
        sz <- file.info(path)$size / 1024 / 1024
        unlink(path)
        data.frame(lib = label,
                   total_s = round(as.numeric(t1 - t0, units = "secs"), 3),
                   html_MB = round(sz, 2))
    }

    rbind(
        measure(quote(reglScatterplot(df, x = "x", y = "y", colorBy = "v",
                                      width = 800, height = 600)), "regl"),
        measure(quote(plotly::plot_ly(df, x = ~x, y = ~y, color = ~v,
                                      type = "scattergl",
                                      mode = "markers",
                                      marker = list(size = 3))), "plotly")
    )
}

for (n in c(1e5, 1e6, 5e6)) {
    cat(sprintf("\n== n = %s ==\n", format(n, big.mark = ",")))
    print(bench_compare_fair(n))
}
