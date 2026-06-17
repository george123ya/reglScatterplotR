"""reglscatterpy - interactive WebGL scatterplots for single-cell data in Python.

The Python companion to the R package ``reglScatterplotR``. Both wrap the
``regl-scatterplot`` WebGL engine; this package adds AnnData / MuData /
SpatialData awareness so you can go from a scanpy object to an interactive
million-point plot in one call::

    import scanpy as sc
    import reglscatterpy as rs

    adata = sc.datasets.pbmc3k_processed()
    rs.scatterplot(adata, x="X_umap", color_by="louvain")
    rs.scatterplot(adata, x="X_umap", color_by="CST3")  # a gene
"""

from ._extract import PlotData, extract
from .scatterplot import scatterplot

__all__ = ["scatterplot", "extract", "PlotData", "__version__"]
__version__ = "0.2.0"
