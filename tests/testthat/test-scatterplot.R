test_that("reglScatterplot returns an htmlwidget of the right class", {
    df <- data.frame(x = 1:10, y = 1:10)
    w <- reglScatterplot(df, x = "x", y = "y")
    expect_s3_class(w, "htmlwidget")
    expect_s3_class(w, "reglScatterplot")
    expect_equal(w$x$n_points, 10L)
})

test_that("reglScatterplot accepts raw vectors when data is NULL", {
    w <- reglScatterplot(x = rnorm(20), y = rnorm(20))
    expect_equal(w$x$n_points, 20L)
})

test_that("reglScatterplot validates input lengths", {
    expect_error(reglScatterplot(x = 1:5, y = 1:4),
                 "same length")
})

test_that("reglScatterplot rejects non-numeric coordinates", {
    expect_error(reglScatterplot(x = letters[1:5], y = 1:5),
                 "must be numeric")
})

test_that("categorical colorBy populates a categorical legend", {
    df <- data.frame(x = 1:6, y = 1:6,
                     g = c("a", "b", "c", "a", "b", "c"))
    w <- reglScatterplot(df, x = "x", y = "y", colorBy = "g")
    expect_equal(w$x$legend$var_type, "categorical")
    expect_equal(length(w$x$legend$names), 3L)
    expect_equal(w$x$options$colorBy, "valueA")
})

test_that("continuous colorBy populates a continuous legend", {
    df <- data.frame(x = 1:50, y = 1:50, v = runif(50))
    w <- reglScatterplot(df, x = "x", y = "y", colorBy = "v")
    expect_equal(w$x$legend$var_type, "continuous")
    expect_length(w$x$options$pointColor, 256L)
})

test_that("xrange and yrange override data extents", {
    w <- reglScatterplot(x = c(1, 2, 3), y = c(1, 2, 3),
                         xrange = c(0, 10), yrange = c(0, 10))
    expect_equal(w$x$x_min, 0)
    expect_equal(w$x$x_max, 10)
    expect_equal(w$x$y_min, 0)
    expect_equal(w$x$y_max, 10)
})

test_that("filterBy must be a data.frame", {
    expect_error(reglScatterplot(x = 1:3, y = 1:3, filterBy = list(a = 1:3)),
                 "data.frame")
})

test_that("pointColor overrides colorBy", {
    df <- data.frame(x = 1:5, y = 1:5, g = letters[1:5])
    w <- reglScatterplot(df, x = "x", y = "y", colorBy = "g",
                         pointColor = "#112233")
    expect_equal(w$x$options$pointColor, "#112233")
})

test_that("performance mode flips on for >500k points", {
    n <- 500001L
    w <- reglScatterplot(x = rnorm(n), y = rnorm(n))
    expect_true(w$x$performanceMode)
    expect_equal(w$x$options$size, 1)
})
