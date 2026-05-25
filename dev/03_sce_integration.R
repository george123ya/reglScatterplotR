## dev/03_sce_integration.R - SingleCellExperiment + SpatialExperiment paths.

library(reglScatterplot)

## ---- Build a small synthetic SCE ------------------------------------------
suppressPackageStartupMessages({
    library(SingleCellExperiment)
    library(SummarizedExperiment)
})

set.seed(1L)
n_cells <- 5000L
n_genes <- 200L

counts <- matrix(rpois(n_genes * n_cells, lambda = 1.5),
                 nrow = n_genes, ncol = n_cells)
rownames(counts) <- paste0("Gene", seq_len(n_genes))
colnames(counts) <- paste0("Cell", seq_len(n_cells))

logc <- log2(counts + 1)

sce <- SingleCellExperiment(
    assays = list(counts = counts, logcounts = logc),
    colData = DataFrame(
        cluster = factor(sample(paste0("c", 1:8), n_cells, replace = TRUE)),
        depth = colSums(counts)
    )
)

## Fake but plausibly clustered UMAP.
mu <- matrix(rnorm(16, sd = 5), 8L, 2L)
clust_ix <- as.integer(sce$cluster)
umap <- mu[clust_ix, ] + matrix(rnorm(2L * n_cells, sd = 0.5), ncol = 2L)
reducedDim(sce, "UMAP") <- umap

## ---- Plot from the SCE -----------------------------------------------------
## width auto-fills the Viewer / cell output; height pinned so it doesn't collapse.
w_cluster <- reglScatterplot(sce, x = "UMAP", colorBy = "cluster",
                             height = 400)
print(w_cluster)

## Colour by a continuous colData column.
w_depth <- reglScatterplot(sce, x = "UMAP", colorBy = "depth",
                           continuousPalette = "magma",
                           vmin = "p1", vmax = "p99",
                           height = 400)
print(w_depth)

## Colour by a gene (reads from logcounts).
w_gene <- reglScatterplot(sce, x = "UMAP", colorBy = "Gene12",
                          continuousPalette = "viridis",
                          height = 400)
print(w_gene)

## ---- SpatialExperiment path (if installed) --------------------------------
if (requireNamespace("SpatialExperiment", quietly = TRUE)) {
    library(SpatialExperiment)
    spe <- SpatialExperiment(
        assays = list(counts = counts),
        colData = DataFrame(spot_type = sce$cluster),
        spatialCoords = umap                   # standing in for tissue coords
    )
    w_spatial <- reglScatterplot(spe, x = "spatial", colorBy = "spot_type",
                                 height = 400, title = "Spatial view")
    print(w_spatial)
} else {
    cat("[skip] SpatialExperiment not installed.\n")
}
