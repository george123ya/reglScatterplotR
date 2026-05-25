## SCE / SpatialExperiment dispatch.
## Each test skips when the relevant Suggests-package is missing, so the
## suite still passes on a barebones install.

skip_if_no_sce <- function() {
    testthat::skip_if_not_installed("SingleCellExperiment")
    testthat::skip_if_not_installed("SummarizedExperiment")
}

test_that("reglScatterplot dispatches on SingleCellExperiment", {
    skip_if_no_sce()
    suppressPackageStartupMessages({
        library(SingleCellExperiment)
        library(SummarizedExperiment)
    })

    set.seed(1L)
    n <- 200L
    counts <- matrix(rpois(20L * n, lambda = 2), nrow = 20L)
    rownames(counts) <- paste0("g", seq_len(20L))
    colnames(counts) <- paste0("c", seq_len(n))
    sce <- SingleCellExperiment(
        assays = list(counts = counts, logcounts = log2(counts + 1)),
        colData = DataFrame(
            cluster = factor(sample(letters[1:3], n, replace = TRUE)),
            depth = runif(n, 1e3, 1e5)
        )
    )
    reducedDim(sce, "UMAP") <- matrix(rnorm(2L * n), ncol = 2L)

    w <- reglScatterplot(sce, x = "UMAP", colorBy = "cluster")
    expect_s3_class(w, "reglScatterplot")
    expect_equal(w$x$n_points, n)
    expect_equal(w$x$legend$var_type, "categorical")
})

test_that("colorBy by gene name reads from the logcounts assay", {
    skip_if_no_sce()
    suppressPackageStartupMessages({
        library(SingleCellExperiment)
        library(SummarizedExperiment)
    })

    n <- 50L
    counts <- matrix(rpois(10L * n, 2), nrow = 10L)
    rownames(counts) <- paste0("g", 1:10)
    sce <- SingleCellExperiment(
        assays = list(logcounts = log2(counts + 1)),
        colData = DataFrame(cluster = factor(rep("a", n)))
    )
    reducedDim(sce, "UMAP") <- matrix(rnorm(2L * n), ncol = 2L)

    w <- reglScatterplot(sce, x = "UMAP", colorBy = "g3")
    expect_s3_class(w, "reglScatterplot")
    expect_equal(w$x$legend$var_type, "continuous")
})

test_that("missing reducedDim errors with a helpful message", {
    skip_if_no_sce()
    suppressPackageStartupMessages(library(SingleCellExperiment))
    sce <- SingleCellExperiment(
        assays = list(counts = matrix(1, 5, 10))
    )
    expect_error(reglScatterplot(sce, x = "UMAP"),
                 "No reducedDims found")
})
