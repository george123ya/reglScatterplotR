# reglscatterpy

Interactive WebGL scatterplots for single-cell data in Python — the companion
to the R package [`reglScatterplotR`](https://github.com/george123ya/reglScatterplotR).
Both wrap the [`regl-scatterplot`](https://github.com/flekschas/regl-scatterplot)
WebGL engine that renders millions of points in the browser.

The point of this package over plain
[`jupyter-scatter`](https://github.com/flekschas/jupyter-scatter) is **native
single-cell awareness**: hand it an `AnnData`, `MuData` or `SpatialData` object
and it pulls embeddings, metadata and gene expression for you — the Python
mirror of the R package's `SingleCellExperiment` / `Seurat` integration.

> **Status: Phase 1.** Rendering is delegated to `jupyter-scatter`. The
> extraction layer (AnnData → coordinates/color) is final and tested; a
> Phase 2 will swap in a shared widget so the Python plot matches the R
> widget's legend / sync / lasso UI pixel-for-pixel.

## Install

```bash
pip install reglscatterpy[render]        # + jupyter-scatter
pip install reglscatterpy[all]           # + anndata, mudata, spatialdata
```

## Quick start

```python
import scanpy as sc
import reglscatterpy as rs

adata = sc.datasets.pbmc3k_processed()

# Colour by a categorical obs column
rs.scatterplot(adata, x="X_umap", color_by="louvain")

# Colour by a gene (read from .X, a layer, or .raw)
rs.scatterplot(adata, x="X_umap", color_by="CST3", continuous_palette="magma")
rs.scatterplot(adata, x="X_umap", color_by="CST3", layer="raw")

# Works with plain tables and arrays too
import numpy as np
rs.scatterplot(np.random.randn(10_000, 2))
```

It runs anywhere `anywidget` does — **Jupyter, JupyterLab, VS Code, Colab** —
and via [`shinywidgets`](https://github.com/posit-dev/py-shinywidgets) inside
**Shiny for Python**. Export a plot to a standalone HTML report with
`ipywidgets.embed.embed_minimal_html`.

## Supported inputs

| Input | Coordinates (`x`) | `color_by` / `group_by` |
|-------|-------------------|-------------------------|
| `AnnData` | `obsm` key (`"X_umap"`, `"umap"`, `"spatial"`, …) | `obs` column or `var_names` feature |
| `MuData` | global `obsm` key | `obs` column or `"modality:feature"` |
| `SpatialData` | table's `obsm` (defaults to `"spatial"`) | table's `obs` / features |
| `pandas.DataFrame` | column name | column name or vector |
| `numpy.ndarray` | column index | vector |

## API parity with R

`rs.scatterplot(...)` mirrors R's `reglScatterplot(...)`: `color_by`/`group_by`,
`point_size`, `opacity`, `continuous_palette`/`categorical_palette`,
`show_axes`, `show_tooltip`, `title`. Anything not surfaced is forwarded to
`jscatter.plot` via `**jscatter_kwargs`.

## Develop / test

```bash
pip install -e .[dev]
pytest          # extraction tests skip cleanly without anndata/scipy
```
