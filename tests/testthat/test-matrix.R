## Plain coordinate-matrix input and Monocle3 (cell_data_set) routing.

test_that("a bare numeric matrix uses its first two columns", {
    m <- matrix(rnorm(40L), ncol = 2L)
    w <- reglScatterplot(m)
    expect_s3_class(w, "reglScatterplot")
    expect_equal(w$x$n_points, 20L)
})

test_that("matrix input accepts colorBy / groupBy vectors", {
    m <- matrix(rnorm(60L), ncol = 3L)
    col <- sample(letters[1:3], 20L, replace = TRUE)
    w <- reglScatterplot(m, colorBy = col)
    expect_equal(w$x$legend$var_type, "categorical")
})

test_that("matrix columns can be chosen by index or name", {
    m <- matrix(rnorm(60L), ncol = 3L)
    colnames(m) <- c("PC1", "PC2", "PC3")
    expect_s3_class(reglScatterplot(m, x = 1L, y = 3L), "reglScatterplot")
    expect_s3_class(reglScatterplot(m, x = "PC1", y = "PC3"), "reglScatterplot")
    expect_error(reglScatterplot(m, x = "nope"), "not found")
})

test_that("a single-column matrix is rejected", {
    expect_error(
        reglScatterplot(matrix(1:10, ncol = 1L)),
        "at least two columns"
    )
})

test_that("Monocle3 cell_data_set routes through the SCE dispatch", {
    ## cell_data_set is a proper S4 subclass of SingleCellExperiment, so the
    ## existing inherits(<>, 'SingleCellExperiment') dispatch and the SCE
    ## accessors (reducedDim, colData, assay) all apply unchanged. Build a real
    ## cds when monocle3 is available; skip otherwise.
    ## monocle3 is GitHub-only (not on CRAN/Bioconductor), so it cannot live in
    ## Suggests. Reach it without a static `monocle3::` reference or a
    ## `library()` call, both of which would trip R CMD check's unstated-
    ## dependency NOTE; skip cleanly when it is absent.
    testthat::skip_if_not_installed("monocle3")
    new_cell_data_set <- getExportedValue("monocle3", "new_cell_data_set")

    set.seed(3L)
    g <- 12L
    n <- 60L
    expr <- matrix(rpois(g * n, 3), nrow = g)
    rownames(expr) <- paste0("gene", seq_len(g))
    colnames(expr) <- paste0("cell", seq_len(n))
    cds <- new_cell_data_set(
        expression_data = expr,
        cell_metadata = data.frame(
            cluster = factor(sample(c("x", "y"), n, replace = TRUE)),
            row.names = colnames(expr)
        ),
        gene_metadata = data.frame(
            gene_short_name = rownames(expr), row.names = rownames(expr)
        )
    )
    SingleCellExperiment::reducedDim(cds, "UMAP") <-
        matrix(rnorm(2L * n), ncol = 2L)

    expect_true(inherits(cds, "SingleCellExperiment"))
    w <- reglScatterplot(cds, x = "UMAP", colorBy = "cluster")
    expect_s3_class(w, "reglScatterplot")
    expect_equal(w$x$n_points, n)
})
