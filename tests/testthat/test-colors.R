test_that(".resolveCategoricalPalette honours customColors mapping", {
    lvls <- c("a", "b", "c")
    cm <- c(a = "#ff0000", b = "#00ff00", c = "#0000ff")
    out <- reglScatterplot:::.resolveCategoricalPalette(lvls, custom_colors = cm)
    expect_equal(out, unname(cm))
})

test_that(".resolveCategoricalPalette fills missing levels from brewer", {
    lvls <- c("a", "b", "c")
    cm <- c(a = "#ff0000")
    out <- reglScatterplot:::.resolveCategoricalPalette(lvls, custom_colors = cm)
    expect_length(out, 3L)
    expect_equal(out[1L], "#ff0000")
    expect_true(all(grepl("^#", out)))
})

test_that(".resolveCategoricalPalette extends past 11 levels", {
    lvls <- as.character(seq_len(15))
    out <- reglScatterplot:::.resolveCategoricalPalette(lvls)
    expect_length(out, 15L)
    expect_true(all(grepl("^#", out)))
})

test_that(".resolveContinuousPalette returns 256 hex colours", {
    for (name in c("viridis", "magma", "plasma", "inferno", "cividis", "turbo")) {
        p <- reglScatterplot:::.resolveContinuousPalette(name)
        expect_length(p, 256L)
        expect_true(all(grepl("^#[0-9a-fA-F]{6}$", p)))
    }
})

test_that(".buildColorPayload selects categorical / continuous correctly", {
    cat_pay <- reglScatterplot:::.buildColorPayload(
        color_vec = factor(c("a", "b", "a", "c")),
        color_var_name = "g", legend_title = NULL, point_color = NULL,
        categorical_palette = "Set1", continuous_palette = "viridis",
        custom_palette = NULL, custom_colors = NULL,
        vmin = NULL, vmax = NULL, center_zero = FALSE)
    expect_equal(cat_pay$legend$var_type, "categorical")
    expect_equal(cat_pay$z, c(0L, 1L, 0L, 2L))

    cont_pay <- reglScatterplot:::.buildColorPayload(
        color_vec = c(0, 5, 10),
        color_var_name = "v", legend_title = NULL, point_color = NULL,
        categorical_palette = "Set1", continuous_palette = "viridis",
        custom_palette = NULL, custom_colors = NULL,
        vmin = NULL, vmax = NULL, center_zero = FALSE)
    expect_equal(cont_pay$legend$var_type, "continuous")
    expect_equal(cont_pay$z, c(0, 0.5, 1))
})

test_that(".buildColorPayload respects centerZero symmetry", {
    pay <- reglScatterplot:::.buildColorPayload(
        color_vec = c(-2, -1, 0, 3),
        color_var_name = "v", legend_title = NULL, point_color = NULL,
        categorical_palette = "Set1", continuous_palette = "viridis",
        custom_palette = NULL, custom_colors = NULL,
        vmin = NULL, vmax = NULL, center_zero = TRUE)
    expect_equal(pay$legend$minVal, -3)
    expect_equal(pay$legend$maxVal, 3)
})

test_that(".buildColorPayload uses pointColor as solid override", {
    pay <- reglScatterplot:::.buildColorPayload(
        color_vec = c(1, 2, 3), color_var_name = "x", legend_title = NULL,
        point_color = "#abcdef",
        categorical_palette = "Set1", continuous_palette = "viridis",
        custom_palette = NULL, custom_colors = NULL,
        vmin = NULL, vmax = NULL, center_zero = FALSE)
    expect_equal(pay$options$pointColor, "#abcdef")
    expect_null(pay$z)
})
