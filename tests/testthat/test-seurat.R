## Seurat dispatch. Skips when SeuratObject is not installed, so the suite
## still passes on a barebones install.

make_toy_seurat <- function(n = 120L, g = 15L) {
    set.seed(7L)
    counts <- matrix(rpois(g * n, lambda = 2), nrow = g)
    rownames(counts) <- paste0("Gene", seq_len(g))
    colnames(counts) <- paste0("Cell", seq_len(n))

    obj <- SeuratObject::CreateSeuratObject(counts = counts)
    ## Populate a "data" (log-normalised-ish) layer without needing Seurat's
    ## NormalizeData(); FetchData reads features from here.
    SeuratObject::LayerData(obj, layer = "data") <- log1p(counts)

    obj$celltype <- factor(sample(c("A", "B", "C"), n, replace = TRUE))

    emb <- matrix(rnorm(2L * n), ncol = 2L)
    rownames(emb) <- colnames(counts)
    colnames(emb) <- c("UMAP_1", "UMAP_2")
    obj[["umap"]] <- SeuratObject::CreateDimReducObject(
        embeddings = emb, key = "UMAP_", assay = "RNA"
    )
    obj
}

test_that("reglScatterplot dispatches on Seurat objects", {
    testthat::skip_if_not_installed("SeuratObject")
    obj <- make_toy_seurat()

    w <- reglScatterplot(obj, x = "UMAP", colorBy = "celltype")
    expect_s3_class(w, "reglScatterplot")
    expect_equal(w$x$n_points, 120L)
    expect_equal(w$x$legend$var_type, "categorical")
})

test_that("colorBy by feature reads from the data layer", {
    testthat::skip_if_not_installed("SeuratObject")
    obj <- make_toy_seurat()

    w <- reglScatterplot(obj, x = "UMAP", colorBy = "Gene3")
    expect_s3_class(w, "reglScatterplot")
    expect_equal(w$x$legend$var_type, "continuous")
})

test_that("reduction name is matched case-insensitively / auto-picked", {
    testthat::skip_if_not_installed("SeuratObject")
    obj <- make_toy_seurat()

    ## Default "UMAP" should resolve to the lowercase "umap" reduction.
    expect_s3_class(reglScatterplot(obj), "reglScatterplot")
    ## Explicit lowercase also works.
    expect_s3_class(reglScatterplot(obj, x = "umap"), "reglScatterplot")
})

test_that("missing reduction errors helpfully", {
    testthat::skip_if_not_installed("SeuratObject")
    obj <- make_toy_seurat()
    expect_error(
        reglScatterplot(obj, x = "tsne"),
        "not found"
    )
})
