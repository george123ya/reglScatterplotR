test_that("%||% returns x when not NULL, else y", {
    expect_equal("a" %||% "b", "a")
    expect_equal(NULL %||% "b", "b")
    expect_equal(0 %||% 99, 0)
    expect_equal(FALSE %||% TRUE, FALSE)
})

test_that("toBase64 round-trips a numeric vector via base64 Float32", {
    v <- c(0, 1, 2.5, -1.5)
    enc <- toBase64(v)
    expect_type(enc, "character")
    expect_true(startsWith(enc, "base64:"))

    raw_bytes <- base64enc::base64decode(sub("^base64:", "", enc))
    expect_length(raw_bytes, length(v) * 4L)

    con <- rawConnection(raw_bytes, "rb")
    on.exit(close(con), add = TRUE)
    decoded <- readBin(con, what = numeric(), n = length(v), size = 4L)
    expect_equal(decoded, v, tolerance = 1e-6)
})

test_that("toBase64 returns NULL for NULL", {
    expect_null(toBase64(NULL))
})

test_that(".parseLimit handles NULL, numeric, percentile, min, max", {
    v <- c(1, 2, 3, 4, 5, 100)
    expect_equal(reglScatterplot:::.parseLimit(NULL, v, min), 1)
    expect_equal(reglScatterplot:::.parseLimit(NULL, v, max), 100)
    expect_equal(reglScatterplot:::.parseLimit(42, v, min), 42)
    expect_equal(reglScatterplot:::.parseLimit("min", v, min), 1)
    expect_equal(reglScatterplot:::.parseLimit("max", v, max), 100)
    expect_equal(
        reglScatterplot:::.parseLimit("p99", v, max),
        unname(stats::quantile(v, 0.99, na.rm = TRUE))
    )
})

test_that(".parseLimit rejects unrecognised strings", {
    expect_error(reglScatterplot:::.parseLimit("garbage", 1:3, min))
})

test_that(".normaliseRange maps endpoints to [-1, 1] and clips outside", {
    v <- c(0, 5, 10, -1, 11)
    out <- reglScatterplot:::.normaliseRange(v, 0, 10)
    expect_equal(out[1L], -1)
    expect_equal(out[2L], 0)
    expect_equal(out[3L], 1)
    expect_equal(out[4L], -1) # clipped low
    expect_equal(out[5L], 1)  # clipped high
})

test_that(".normaliseRange handles a degenerate range", {
    expect_equal(reglScatterplot:::.normaliseRange(c(3, 3, 3), 3, 3),
                 c(0, 0, 0))
})

test_that(".resolveColumn returns vector pass-through and column lookup", {
    df <- data.frame(a = 1:3, b = letters[1:3])
    expect_equal(reglScatterplot:::.resolveColumn("a", df), 1:3)
    expect_equal(reglScatterplot:::.resolveColumn(1:3, NULL), 1:3)
    expect_null(reglScatterplot:::.resolveColumn(NULL, df))
})

test_that(".validateCoord errors for non-numeric / empty / NULL", {
    expect_error(reglScatterplot:::.validateCoord(NULL, "x"))
    expect_error(reglScatterplot:::.validateCoord(numeric(0), "x"))
    expect_error(reglScatterplot:::.validateCoord(letters, "x"))
    expect_true(reglScatterplot:::.validateCoord(1:5, "x"))
})
