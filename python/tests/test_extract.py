"""Tests for the render-agnostic extraction layer.

These need no JS/widget stack - only numpy (always) and, for the richer
cases, pandas / anndata (skipped when missing).
"""

import numpy as np
import pandas as pd
import pytest

from reglscatterpy import extract


def test_numpy_array_uses_first_two_columns():
    arr = np.random.RandomState(0).randn(50, 3)
    pd_ = extract(arr)
    assert pd_.n == 50
    np.testing.assert_array_equal(pd_.x, arr[:, 0])
    np.testing.assert_array_equal(pd_.y, arr[:, 1])


def test_numpy_array_column_selection_and_color():
    arr = np.random.RandomState(1).randn(20, 4)
    col = np.repeat(["a", "b"], 10)
    pd_ = extract(arr, x=2, y=3, color_by=col)
    np.testing.assert_array_equal(pd_.x, arr[:, 2])
    assert pd_.color is not None and pd_.color.shape[0] == 20


def test_array_needs_two_columns():
    with pytest.raises(ValueError):
        extract(np.zeros((10, 1)))


def test_unsupported_type():
    with pytest.raises(TypeError):
        extract("not a dataset")


def test_dataframe():
    pd = pytest.importorskip("pandas")
    df = pd.DataFrame(
        {"u1": [0.0, 1.0], "u2": [1.0, 0.0], "ct": ["A", "B"]}
    )
    pd_ = extract(df, x="u1", y="u2", color_by="ct")
    assert pd_.color_name == "ct"
    assert pd_.xlab == "u1"


def test_dataframe_requires_xy():
    pd = pytest.importorskip("pandas")
    df = pd.DataFrame({"a": [1, 2], "b": [3, 4]})
    with pytest.raises(ValueError):
        extract(df)


# --------------------------------------------------------------------------- #
# AnnData
# --------------------------------------------------------------------------- #
def _toy_anndata(n=80, g=12):
    ad = pytest.importorskip("anndata")
    rng = np.random.RandomState(2)
    import pandas as pd

    X = rng.poisson(2, size=(n, g)).astype(float)
    var = pd.DataFrame(index=[f"Gene{i}" for i in range(g)])
    obs = pd.DataFrame(
        {"celltype": pd.Categorical(rng.choice(["T", "B", "NK"], n))},
        index=[f"cell{i}" for i in range(n)],
    )
    adata = ad.AnnData(X=X, obs=obs, var=var)
    adata.obsm["X_umap"] = rng.randn(n, 2)
    return adata


def test_anndata_basis_and_obs_color():
    adata = _toy_anndata()
    pd_ = extract(adata, x="umap", color_by="celltype")
    assert pd_.n == adata.n_obs
    assert pd_.color_name == "celltype"
    assert pd_.xlab == "UMAP 1"


def test_anndata_default_basis_autopick():
    adata = _toy_anndata()
    pd_ = extract(adata)  # no x -> should find X_umap
    assert pd_.xlab == "UMAP 1"


def test_anndata_color_by_gene_reads_X():
    adata = _toy_anndata()
    pd_ = extract(adata, x="umap", color_by="Gene3")
    assert pd_.color is not None
    np.testing.assert_allclose(pd_.color, np.asarray(adata[:, "Gene3"].X).ravel())


def test_anndata_unknown_key_errors():
    adata = _toy_anndata()
    with pytest.raises(KeyError):
        extract(adata, x="umap", color_by="not_a_thing")


def test_anndata_sparse_gene():
    sparse = pytest.importorskip("scipy.sparse")
    adata = _toy_anndata()
    adata.X = sparse.csr_matrix(adata.X)
    pd_ = extract(adata, x="umap", color_by="Gene1")
    assert pd_.color.ndim == 1 and pd_.color.shape[0] == adata.n_obs


def test_mudata_per_modality_embedding_and_feature():
    """MuData: 'rna:X_umap' embedding + colour from either modality."""
    mu = pytest.importorskip("mudata")
    ad = pytest.importorskip("anndata")
    rng = np.random.default_rng(0)
    m = 100
    idx = [f"c{i}" for i in range(m)]
    rna = ad.AnnData(
        rng.poisson(2, (m, 10)).astype(float),
        obs=pd.DataFrame({"celltype": pd.Categorical(rng.choice(list("TBN"), m))}, index=idx),
        var=pd.DataFrame(index=[f"Gene{i}" for i in range(10)]),
    )
    rna.obsm["X_umap"] = rng.normal(0, 1, (m, 2))
    adt = ad.AnnData(
        rng.poisson(5, (m, 4)).astype(float),
        obs=pd.DataFrame(index=idx),
        var=pd.DataFrame(index=[f"AB{i}" for i in range(4)]),
    )
    mdata = mu.MuData({"rna": rna, "adt": adt})

    p1 = extract(mdata, x="rna:X_umap", color_by="rna:celltype")
    assert p1.n == m and p1.x.shape[0] == m
    assert not np.issubdtype(np.asarray(p1.color).dtype, np.number)  # categorical

    p2 = extract(mdata, x="rna:X_umap", color_by="adt:AB0")          # cross-modality feature
    assert p2.n == m
    assert np.issubdtype(np.asarray(p2.color).dtype, np.number)      # continuous
