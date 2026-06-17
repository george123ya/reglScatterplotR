"""The public ``scatterplot()`` entry point.

Phase 1 renders through `jupyter-scatter <https://github.com/flekschas/jupyter-scatter>`_
(``jscatter``), the anywidget-based Python binding to the same ``regl-scatterplot``
engine the R package wraps. So this works out of the box in Jupyter, JupyterLab,
VS Code, Colab and - via ``shinywidgets`` - Shiny for Python, and can be exported
to a self-contained HTML report with ``ipywidgets.embed.embed_minimal_html``.

The function signature deliberately mirrors the R ``reglScatterplot()`` so the
two feel like one tool across languages. Some options that depend on the
package's *own* widget UI (the draggable click-to-filter legend, cross-plot
sync, lasso-to-filter) are stubbed/limited here and land fully in Phase 2, when
rendering moves to a shared ES module driving an anywidget in Python and an
htmlwidget in R.
"""

from __future__ import annotations

from typing import Any, Optional, Sequence, Union

import pandas as pd

from ._extract import ColorSpec, PlotData, extract

__all__ = ["scatterplot"]


def _is_categorical(values) -> bool:
    s = pd.Series(values)
    return not pd.api.types.is_numeric_dtype(s)


def scatterplot(
    data: Any = None,
    *,
    x: Optional[Union[str, int]] = None,
    y: Optional[Union[str, int]] = None,
    color_by: ColorSpec = None,
    group_by: ColorSpec = None,
    layer: Optional[str] = None,
    dims: Optional[tuple] = None,
    table: Optional[str] = None,
    point_size: Optional[float] = None,
    opacity: Optional[float] = None,
    categorical_palette: Optional[Union[str, Sequence, dict]] = None,
    continuous_palette: str = "viridis",
    title: Optional[str] = None,
    xlab: Optional[str] = None,
    ylab: Optional[str] = None,
    show_axes: bool = True,
    show_tooltip: bool = True,
    legend: bool = True,
    background_color: Optional[str] = None,
    width: Optional[int] = None,
    height: int = 500,
    show: bool = True,
    **jscatter_kwargs: Any,
):
    """Interactive WebGL scatterplot from single-cell / tabular data.

    Parameters
    ----------
    data
        An ``AnnData``, ``MuData``, ``SpatialData``, pandas ``DataFrame`` or
        numpy array. See :func:`reglscatterpy._extract.extract`.
    x, y
        Embedding selector (``obsm`` key, e.g. ``"X_umap"`` or ``"umap"``) for
        single-cell objects, or column names / indices for tables and arrays.
    color_by, group_by
        ``obs`` column name, feature in ``var_names``, or a raw vector. For
        ``MuData`` a feature is addressed as ``"modality:feature"``.
    layer
        Expression source when ``color_by`` is a feature: ``None`` -> ``.X``,
        a layer name, or ``"raw"``.
    point_size, opacity
        Point styling. Sensible defaults are picked from the point count when
        left as ``None``, matching the R package.
    continuous_palette
        A matplotlib colormap name used for numeric ``color_by``.
    categorical_palette
        A list/dict of colors (or a named palette jscatter understands) used
        for categorical ``color_by``.
    show
        When ``True`` (default) return the displayable widget; otherwise return
        the configured ``jscatter.Scatter`` for further chaining.
    **jscatter_kwargs
        Forwarded verbatim to ``jscatter.plot`` for anything not surfaced here.

    Returns
    -------
    The jupyter-scatter widget (or ``Scatter`` when ``show=False``).
    """
    try:
        import jscatter
    except ModuleNotFoundError as exc:  # pragma: no cover - import guard
        raise ModuleNotFoundError(
            "reglscatterpy needs 'jupyter-scatter'. "
            "Install with: pip install reglscatterpy[render]"
        ) from exc

    pd_data: PlotData = extract(
        data, x=x, y=y, color_by=color_by, group_by=group_by,
        layer=layer, dims=dims, table=table,
    )

    df = pd.DataFrame({"x": pd_data.x, "y": pd_data.y})
    color_col = None
    if pd_data.color is not None:
        color_col = pd_data.color_name or "color"
        series = pd.Series(pd_data.color)
        # jscatter infers categorical from non-numeric dtype; make it explicit.
        if _is_categorical(series):
            series = series.astype("category")
        df[color_col] = series.to_numpy()
    if pd_data.group is not None:
        # Carried through for parity; full group-intersect filtering is Phase 2.
        df[pd_data.group_name or "group"] = pd_data.group

    # adaptive defaults, matching the R heuristics
    n = pd_data.n
    if point_size is None:
        point_size = (
            1 if n > 500_000
            else 5 if n < 5_000
            else 4 if n < 50_000
            else 3
        )
    if opacity is None:
        opacity = 1.0 if n > 500_000 else 0.8

    opts: dict[str, Any] = {
        "data": df,
        "x": "x",
        "y": "y",
        "size": point_size,
        "opacity": opacity,
        "height": height,
        "axes": show_axes,
        "legend": legend,
    }
    if color_col is not None:
        opts["color_by"] = color_col
        if _is_categorical(df[color_col]):
            if categorical_palette is not None:
                opts["color_map"] = categorical_palette
        else:
            opts["color_map"] = continuous_palette
    if background_color is not None:
        opts["background_color"] = background_color
    if width is not None:
        opts["width"] = width
    if title is not None:
        opts["title"] = title
    opts.update(jscatter_kwargs)

    scatter = jscatter.plot(**opts)

    # axis labels (jscatter sets these via .label when available)
    try:
        scatter.label(
            x=xlab or pd_data.xlab,
            y=ylab or pd_data.ylab,
        )
    except Exception:  # pragma: no cover - older jscatter without .label
        pass
    if not show_tooltip:
        try:
            scatter.tooltip(False)
        except Exception:  # pragma: no cover
            pass

    return scatter.show() if show else scatter
