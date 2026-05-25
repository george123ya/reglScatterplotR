## dev/04_perf_bench.R - R-side build + serialize ladder.

library(reglScatterplot)

bench_sizes <- c(1e4, 5e4, 1e5, 5e5, 1e6, 2e6, 5e6)
results <- data.frame()

for (n in bench_sizes) {
    cat(sprintf("→ %s pts...\n", format(n, big.mark = ",")))
    df <- data.frame(
        x = rnorm(n), y = rnorm(n),
        cluster = sample(letters[1:8], n, replace = TRUE)
    )
    t0 <- Sys.time()
    w  <- reglScatterplot(df, x = "x", y = "y",
                          colorBy = "cluster", height = 600)
    t_build <- as.numeric(Sys.time() - t0, units = "secs")

    t1 <- Sys.time()
    payload <- htmlwidgets:::toJSON(w$x)
    t_serial <- as.numeric(Sys.time() - t1, units = "secs")

    results <- rbind(results, data.frame(
        n_points = n,
        t_build_s = round(t_build, 3),
        t_serialize_s = round(t_serial, 3),
        payload_MB = round(nchar(payload) / 1024 / 1024, 2)
    ))
    rm(df, w, payload); gc(verbose = FALSE)
}
print(results)
