## AnnData (in-memory R6) dispatch. Built against anndataR (pure R); the same
## field interface is used by the `anndata` CRAN package. Skips when anndataR
## is not installed.

make_toy_anndata <- function(n = 80L, g = 10L) {
    set.seed(11L)
    X <- matrix(rpois(n * g, lambda = 2), nrow = n) # obs x var
    colnames(X) <- paste0("Gene", seq_len(g))
    rownames(X) <- paste0("cell", seq_len(n))
    obs <- data.frame(
        celltype = factor(sample(c("A", "B", "C"), n, replace = TRUE)),
        score = runif(n),
        row.names = rownames(X)
    )
    anndataR::AnnData(
        X = X,
        obs = obs,
        var = data.frame(row.names = colnames(X)),
        obsm = list(X_umap = matrix(rnorm(2L * n), ncol = 2L))
    )
}

test_that("reglScatterplot dispatches on an in-memory AnnData", {
    testthat::skip_if_not_installed("anndataR")
    ad <- make_toy_anndata()

    w <- reglScatterplot(ad, x = "umap", colorBy = "celltype")
    expect_s3_class(w, "reglScatterplot")
    expect_equal(w$x$n_points, 80L)
    expect_equal(w$x$legend$var_type, "categorical")
})

test_that("colorBy resolves obs columns and features", {
    testthat::skip_if_not_installed("anndataR")
    ad <- make_toy_anndata()

    expect_equal(
        reglScatterplot(ad, x = "umap", colorBy = "score")$x$legend$var_type,
        "continuous"
    )
    expect_equal(
        reglScatterplot(ad, x = "umap", colorBy = "Gene4")$x$legend$var_type,
        "continuous"
    )
})

test_that("basis is auto-picked and matched case-insensitively", {
    testthat::skip_if_not_installed("anndataR")
    ad <- make_toy_anndata()
    ## default "UMAP" should find the scanpy-style "X_umap"
    expect_s3_class(reglScatterplot(ad), "reglScatterplot")
    expect_s3_class(reglScatterplot(ad, x = "X_umap"), "reglScatterplot")
})

test_that("unknown colorBy / embedding error helpfully", {
    testthat::skip_if_not_installed("anndataR")
    ad <- make_toy_anndata()
    expect_error(
        reglScatterplot(ad, x = "umap", colorBy = "nope"),
        "neither an .obs column nor a feature"
    )
    expect_error(reglScatterplot(ad, x = "tsne"), "not found")
})
