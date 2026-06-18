"""The public ``scatterplot()`` entry point.

By default this renders through reglscatterpy's **own** anywidget, which drives
the very same compiled widget the R package ships (legend, lasso, tooltips,
sync, PNG/SVG/PDF export) - so a plot is pixel-identical across R and Python.
It works in Jupyter, JupyterLab, VS Code, Colab and (via ``shinywidgets``)
Shiny for Python, and embeds into self-contained HTML.

Pass ``backend="jscatter"`` to render through `jupyter-scatter
<https://github.com/flekschas/jupyter-scatter>`_ instead (the JS author's
binding) - lighter, but without the package's own legend / sync / export UI.

The signature mirrors the R ``reglScatterplot()`` so the two feel like one tool.
"""

from __future__ import annotations

from typing import Any, Optional, Sequence, Union

import pandas as pd

from ._extract import ColorSpec, PlotData, extract
from ._payload import build_payload

__all__ = ["scatterplot"]


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
    point_color: Optional[str] = None,
    pixel_ratio: Optional[float] = None,
    categorical_palette: str = "Set1",
    continuous_palette: str = "viridis",
    custom_palette: Optional[Sequence[str]] = None,
    custom_colors: Optional[dict] = None,
    vmin: Any = None,
    vmax: Any = None,
    center_zero: bool = False,
    title: Optional[str] = None,
    xlab: Optional[str] = None,
    ylab: Optional[str] = None,
    legend_title: Optional[str] = None,
    show_axes: bool = True,
    show_tooltip: bool = True,
    background_color: Optional[str] = None,
    axis_color: str = "#333333",
    legend_bg: str = "#ffffff",
    legend_text: str = "#000000",
    legend_position: str = "top-right",
    draggable_legend: bool = True,
    enable_download: bool = False,
    font_size: int = 12,
    legend_font_size: int = 12,
    auto_fit: bool = False,
    range_padding: float = 0.15,
    xrange: Optional[Sequence[float]] = None,
    yrange: Optional[Sequence[float]] = None,
    filter_by: Any = None,
    point_labels: Optional[Sequence] = None,
    plot_id: Optional[str] = None,
    width: Optional[int] = 700,
    height: int = 500,
    backend: str = "regl",
    show: bool = True,
    **backend_kwargs: Any,
):
    """Interactive WebGL scatterplot from single-cell / tabular data.

    Parameters
    ----------
    data
        ``AnnData``, ``MuData``, ``SpatialData``, pandas ``DataFrame`` or numpy
        array. See :func:`reglscatterpy._extract.extract`.
    x, y
        Embedding selector (``obsm`` key, e.g. ``"X_umap"`` or ``"umap"``) for
        single-cell objects, or column names / indices for tables and arrays.
    color_by, group_by
        ``obs`` column, a feature in ``var_names``, or a raw vector
        (``"modality:feature"`` for ``MuData``).
    point_color
        A fixed hex colour overriding ``color_by``.
    pixel_ratio
        Device-pixel-ratio for the WebGL backing store (defaults to a crisp
        ``max(devicePixelRatio, 2)`` in-widget).
    categorical_palette
        A ColorBrewer qualitative palette name (``"Set1"``, ``"Dark2"`` ...).
    continuous_palette
        A viridis-family name (``"viridis"``, ``"magma"`` ...).
    custom_colors, custom_palette
        Explicit per-level mapping (dict) or ordered list of colours.
    filter_by
        A dict / DataFrame of numeric columns shown as interactive range
        filters.
    backend
        ``"regl"`` (default) renders the package's own widget; ``"jscatter"``
        uses jupyter-scatter.
    show
        When ``True`` (default) returns the displayable widget.

    Returns
    -------
    The widget object (displays inline in notebooks).
    """
    pd_data: PlotData = extract(
        data, x=x, y=y, color_by=color_by, group_by=group_by,
        layer=layer, dims=dims, table=table,
    )

    # adaptive defaults, matching the R heuristics
    n = pd_data.n
    if point_size is None:
        point_size = 1 if n > 500_000 else 5 if n < 5_000 else 4 if n < 50_000 else 3
    if opacity is None:
        opacity = 1.0 if n > 500_000 else 0.8

    if backend == "jscatter":
        return _scatterplot_jscatter(
            pd_data, point_size=point_size, opacity=opacity,
            categorical_palette=custom_colors or custom_palette or categorical_palette,
            continuous_palette=continuous_palette, title=title, xlab=xlab, ylab=ylab,
            show_axes=show_axes, show_tooltip=show_tooltip,
            background_color=background_color, width=width, height=height,
            show=show, **backend_kwargs,
        )
    if backend != "regl":
        raise ValueError("backend must be 'regl' or 'jscatter'.")

    spec = build_payload(
        pd_data,
        point_size=point_size, opacity=opacity, point_color=point_color,
        pixel_ratio=pixel_ratio,
        categorical_palette=categorical_palette, continuous_palette=continuous_palette,
        custom_palette=custom_palette, custom_colors=custom_colors,
        vmin=vmin, vmax=vmax, center_zero=center_zero,
        xrange=xrange, yrange=yrange, range_padding=range_padding,
        xlab=xlab, ylab=ylab, title=title, legend_title=legend_title,
        show_axes=show_axes, show_tooltip=show_tooltip,
        background_color=background_color, axis_color=axis_color,
        legend_bg=legend_bg, legend_text=legend_text,
        legend_position=legend_position, draggable_legend=draggable_legend,
        enable_download=enable_download, font_size=font_size,
        legend_font_size=legend_font_size, auto_fit=auto_fit,
        point_labels=point_labels, plot_id=plot_id, filter_by=filter_by,
    )

    from ._widget import ReglScatter

    widget = ReglScatter()
    widget._height = int(height)
    widget._width = int(width) if width else 0   # 0 => responsive (100%)
    widget._spec = spec
    return widget


def _scatterplot_jscatter(
    pd_data: PlotData, *, point_size, opacity, categorical_palette,
    continuous_palette, title, xlab, ylab, show_axes, show_tooltip,
    background_color, width, height, show, **jscatter_kwargs,
):
    try:
        import jscatter
    except ModuleNotFoundError as exc:  # pragma: no cover - import guard
        raise ModuleNotFoundError(
            "backend='jscatter' needs 'jupyter-scatter'. "
            "Install with: pip install reglscatterpy[render]"
        ) from exc

    df = pd.DataFrame({"x": pd_data.x, "y": pd_data.y})
    color_col = None
    if pd_data.color is not None:
        color_col = pd_data.color_name or "color"
        series = pd.Series(pd_data.color)
        if not pd.api.types.is_numeric_dtype(series):
            series = series.astype("category")
        df[color_col] = series.to_numpy()

    opts: dict[str, Any] = {
        "data": df, "x": "x", "y": "y", "size": point_size, "opacity": opacity,
        "height": height, "axes": show_axes,
    }
    if color_col is not None:
        opts["color_by"] = color_col
        if not pd.api.types.is_numeric_dtype(df[color_col]):
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
    try:
        scatter.label(x=xlab or pd_data.xlab, y=ylab or pd_data.ylab)
    except Exception:  # pragma: no cover
        pass
    if not show_tooltip:
        try:
            scatter.tooltip(False)
        except Exception:  # pragma: no cover
            pass
    return scatter.show() if show else scatter
