## ----------------------------------------------------------------------------
## Generates data/reglScatterExample.rda
## ----------------------------------------------------------------------------
##
## A small, synthetic single-cell-style UMAP embedding used by the examples,
## vignette and tests so users can plot something the moment they install the
## package - no download, no Suggests-package required.
##
## Run from the package root with:  Rscript data-raw/make_reglScatterExample.R
## (excluded from the build via .Rbuildignore.)

set.seed(42L)

## Eight "cell types", each a Gaussian blob in 2-D UMAP space. Centres and
## spreads are hand-picked so the clusters read as a believable UMAP rather
## than a uniform cloud.
celltypes <- c(
    "CD4 T", "CD8 T", "NK", "B", "Monocyte",
    "Dendritic", "Platelet", "Progenitor"
)
centres <- rbind(
    c(-5.0, 2.5), c(-4.0, 4.5), c(-1.0, 6.0), c(3.5, 4.0),
    c(5.0, -2.0), c(2.0, -4.5), c(-3.0, -5.0), c(0.0, 0.0)
)
spreads <- c(0.9, 0.8, 0.7, 1.0, 1.1, 0.6, 0.5, 0.7)
sizes <- c(820, 540, 280, 610, 690, 210, 120, 130)

n <- sum(sizes)
umap <- matrix(NA_real_, nrow = n, ncol = 2L)
celltype <- character(n)
i <- 0L
for (k in seq_along(celltypes)) {
    idx <- (i + 1L):(i + sizes[k])
    umap[idx, ] <- cbind(
        rnorm(sizes[k], centres[k, 1L], spreads[k]),
        rnorm(sizes[k], centres[k, 2L], spreads[k])
    )
    celltype[idx] <- celltypes[k]
    i <- i + sizes[k]
}

## Realistic-looking continuous covariates.
nCount <- round(rlnorm(n, meanlog = 8.4, sdlog = 0.45))
nFeature <- round(nCount^0.62 * runif(n, 1.6, 2.2))
percentMito <- pmin(round(rbeta(n, 1.4, 28) * 100, 2), 25)

## A marker-like gradient: high in T/NK, low elsewhere, with dropout.
cd3d_base <- ifelse(celltype %in% c("CD4 T", "CD8 T", "NK"),
    rnorm(n, 3.4, 0.7), rnorm(n, 0.2, 0.3)
)
CD3D <- pmax(0, round(cd3d_base * rbinom(n, 1L, 0.85), 3))

reglScatterExample <- data.frame(
    UMAP_1 = round(umap[, 1L], 4),
    UMAP_2 = round(umap[, 2L], 4),
    celltype = factor(celltype, levels = celltypes),
    nCount = as.integer(nCount),
    nFeature = as.integer(nFeature),
    percentMito = percentMito,
    CD3D = CD3D,
    stringsAsFactors = FALSE
)

## Shuffle rows so plotting order doesn't paint clusters in blocks.
reglScatterExample <- reglScatterExample[sample(n), ]
rownames(reglScatterExample) <- NULL

## Bioconductor discourages `LazyData: true`; ship a compressed .rda and let
## users load it with data(reglScatterExample).
save(reglScatterExample,
    file = "data/reglScatterExample.rda",
    compress = "xz"
)

message(sprintf(
    "Wrote data/reglScatterExample.rda  (%d cells, %d cols)",
    nrow(reglScatterExample), ncol(reglScatterExample)
))
