"""Build the exact ``xData`` payload the bundled JS widget expects.

This is a faithful Python port of the payload construction in the R package
(``R/utils.R``, ``R/colors.R``, ``R/scatterplot.R``).  Because both languages
drive the *same* compiled widget (``inst/htmlwidgets/reglScatterplot.js`` in R,
the anywidget bundle in ``static/`` here), the base64-quantised coordinates,
the colour/legend payload and the option keys must be byte-for-byte identical.
The R-vs-Python equivalence is locked down by ``tests/test_payload_parity``.

Encoders (mirroring ``R/utils.R``):

* ``base64:``      little-endian float32           (generic)
* ``base64u16:``   uint16 of ``round((v+1)*32767.5)``  for x/y in [-1, 1]
* ``base64u16u:``  uint16 of ``round(v*65535)``         for continuous z in [0, 1]
* ``base64u16i:``  uint16 integer indices              for categorical / groups
"""

from __future__ import annotations

import base64
from typing import Any, Optional, Sequence

import numpy as np
import pandas as pd

from ._extract import PlotData
from ._palettes import CONTINUOUS, QUALITATIVE

__all__ = ["build_payload"]


# --------------------------------------------------------------------------- #
# base64 encoders  (R/utils.R)
# --------------------------------------------------------------------------- #
def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def to_base64_f32(vec: Optional[np.ndarray]) -> Optional[str]:
    if vec is None:
        return None
    arr = np.ascontiguousarray(np.asarray(vec, dtype="<f4"))
    return "base64:" + _b64(arr.tobytes())


def to_base64_u16(vec: Optional[np.ndarray]) -> Optional[str]:
    """x/y in [-1, 1] -> uint16 (matches R `.toBase64U16`)."""
    if vec is None:
        return None
    v = np.clip(np.asarray(vec, dtype="float64"), -1.0, 1.0)
    ints = np.rint((v + 1.0) * 32767.5).astype("int64")
    ints = np.clip(ints, 0, 65535).astype("<u2")
    return "base64u16:" + _b64(np.ascontiguousarray(ints).tobytes())


def to_base64_u16_unit(vec: Optional[np.ndarray]) -> Optional[str]:
    """continuous z in [0, 1] -> uint16 (matches R `.toBase64U16Unit`)."""
    if vec is None:
        return None
    v = np.clip(np.asarray(vec, dtype="float64"), 0.0, 1.0)
    ints = np.rint(v * 65535).astype("int64")
    ints = np.clip(ints, 0, 65535).astype("<u2")
    return "base64u16u:" + _b64(np.ascontiguousarray(ints).tobytes())


def to_base64_u16_int(vec: Optional[np.ndarray]) -> Optional[str]:
    """small non-negative integer indices -> uint16 (matches R `.toBase64U16Int`)."""
    if vec is None:
        return None
    ints = np.asarray(vec, dtype="int64")
    if ints.size and (ints.min() < 0 or ints.max() > 65535):
        raise ValueError("integers must lie in [0, 65535].")
    return "base64u16i:" + _b64(np.ascontiguousarray(ints.astype("<u2")).tobytes())


# --------------------------------------------------------------------------- #
# range normalisation  (R/utils.R `.normaliseRange`, `.padRange`)
# --------------------------------------------------------------------------- #
def _pad_range(lo: float, hi: float, frac: float) -> tuple[float, float]:
    d = hi - lo
    if not np.isfinite(d) or d == 0:
        return lo, hi
    return lo - d * frac, hi + d * frac


def _normalise_range(vec: np.ndarray, lo: float, hi: float) -> np.ndarray:
    if hi == lo:
        return np.zeros_like(vec, dtype="float64")
    out = (np.asarray(vec, dtype="float64") - lo) * (2.0 / (hi - lo)) - 1.0
    return np.clip(out, -1.0, 1.0)


# --------------------------------------------------------------------------- #
# palettes  (R/colors.R)
# --------------------------------------------------------------------------- #
def _to_hex7(col: str) -> str:
    return col[:7]


def _resolve_categorical_palette(
    levels: Sequence[str],
    custom_colors: Optional[dict] = None,
    custom_palette: Optional[Sequence[str]] = None,
    categorical_palette: str = "Set1",
) -> list[str]:
    n = len(levels)
    cols: list[Optional[str]] = [None] * n

    if custom_colors:
        cols = [custom_colors.get(lv) for lv in levels]
    elif custom_palette is not None:
        if isinstance(custom_palette, dict):
            cols = [custom_palette.get(lv) for lv in levels]
        else:
            cp = list(custom_palette)
            cols = [cp[i] if i < len(cp) else None for i in range(n)]

    if any(c is None for c in cols):
        base = QUALITATIVE.get(categorical_palette, QUALITATIVE["Set1"])
        max_n = len(base)
        if n > max_n:
            fallback = _color_ramp(base, n)          # interpolate when too many levels
        else:
            fallback = base[:n]
        cols = [c if c is not None else fallback[i] for i, c in enumerate(cols)]

    return [_to_hex7(c if c is not None else "#808080") for c in cols]


def _color_ramp(colors: Sequence[str], n: int) -> list[str]:
    """Linear-RGB interpolation across `colors` to n steps.

    Used only when the number of categories exceeds the palette size (rare).
    R uses Lab-space `colorRampPalette`; results may differ slightly here.
    """
    rgb = np.array([[int(c[i : i + 2], 16) for i in (1, 3, 5)] for c in colors], dtype=float)
    xs = np.linspace(0, len(colors) - 1, n)
    out = []
    for x in xs:
        lo = int(np.floor(x))
        hi = min(lo + 1, len(colors) - 1)
        t = x - lo
        c = np.rint(rgb[lo] * (1 - t) + rgb[hi] * t).astype(int)
        out.append("#{:02X}{:02X}{:02X}".format(*c))
    return out


def _resolve_continuous_palette(name: str = "viridis") -> list[str]:
    return list(CONTINUOUS.get(name, CONTINUOUS["viridis"]))


# --------------------------------------------------------------------------- #
# vmin/vmax  (R/utils.R `.parseLimit`)
# --------------------------------------------------------------------------- #
def _parse_limit(limit: Any, data: np.ndarray, default) -> float:
    if limit is None:
        return float(default(data))
    if isinstance(limit, (int, float, np.number)):
        return float(limit)
    if isinstance(limit, str):
        if limit == "min":
            return float(np.nanmin(data))
        if limit == "max":
            return float(np.nanmax(data))
        if limit.startswith("p"):
            return float(np.nanpercentile(data, float(limit[1:])))
    raise ValueError("vmin/vmax must be None, numeric, 'min', 'max' or 'pNN'.")


# --------------------------------------------------------------------------- #
# colour payload  (R/colors.R `.buildColorPayload`)
# --------------------------------------------------------------------------- #
def _build_color_payload(
    color_vec,
    color_var_name,
    legend_title,
    point_color,
    categorical_palette,
    continuous_palette,
    custom_palette,
    custom_colors,
    vmin,
    vmax,
    center_zero,
):
    options: dict = {}
    legend: dict = {}
    z = None

    if point_color is not None:
        return {"options": {"pointColor": point_color, "colorBy": None}, "legend": {}, "z": None}

    if color_vec is None:
        return {"options": {"pointColor": "#0072B2", "colorBy": None}, "legend": {}, "z": None}

    s = pd.Series(color_vec)
    is_categorical = (
        s.dtype == object
        or isinstance(s.dtype, pd.CategoricalDtype)
        or s.dtype == bool
        or not np.issubdtype(s.dtype, np.number)
    )

    if is_categorical:
        cat = s.astype("category")
        levels = list(cat.cat.categories)
        hex_cols = _resolve_categorical_palette(
            [str(lv) for lv in levels], custom_colors, custom_palette, categorical_palette
        )
        z = cat.cat.codes.to_numpy().astype("int64")  # 0-based, matches as.integer(f)-1
        options = {"colorBy": "valueA", "pointColor": hex_cols}
        legend = {
            "names": [str(lv) for lv in levels],
            "colors": hex_cols,
            "var_type": "categorical",
            "title": legend_title,
            "var_name": color_var_name,
        }
        return {"options": options, "legend": legend, "z": z}

    # numeric / continuous
    vals = s.to_numpy().astype("float64")
    c_min = _parse_limit(vmin, vals, np.nanmin)
    c_max = _parse_limit(vmax, vals, np.nanmax)
    if center_zero:
        abs_lim = max(abs(c_min), abs(c_max))
        c_min, c_max = -abs_lim, abs_lim
    rng = c_max - c_min or 1.0
    z = np.clip((vals - c_min) / rng, 0.0, 1.0)
    p_hex = _resolve_continuous_palette(continuous_palette)
    options = {"colorBy": "valueA", "pointColor": p_hex}
    legend = {
        "minVal": c_min,
        "maxVal": c_max,
        "midVal": (c_min + c_max) / 2.0,
        "var_type": "continuous",
        "colors": p_hex,
        "title": legend_title if legend_title is not None else "Value",
        "var_name": color_var_name,
    }
    return {"options": options, "legend": legend, "z": z}


def _resolve_legend_position(pos):
    if pos is None:
        return {"anchor": "top-right"}
    if isinstance(pos, (list, tuple)) and len(pos) == 2 and all(
        isinstance(v, (int, float)) for v in pos
    ):
        return {"anchor": "custom", "x": float(pos[0]), "y": float(pos[1])}
    valid = {"top-right", "top-left", "bottom-right", "bottom-left"}
    if isinstance(pos, str) and pos in valid:
        return {"anchor": pos}
    raise ValueError(
        "legend_position must be one of 'top-right', 'top-left', 'bottom-right', "
        "'bottom-left', or a length-2 (x, y)."
    )


# --------------------------------------------------------------------------- #
# top-level builder  (R/scatterplot.R)
# --------------------------------------------------------------------------- #
def build_payload(
    data: PlotData,
    *,
    point_size=None,
    opacity=None,
    point_color=None,
    pixel_ratio=None,
    categorical_palette="Set1",
    continuous_palette="viridis",
    custom_palette=None,
    custom_colors=None,
    vmin=None,
    vmax=None,
    center_zero=False,
    xrange=None,
    yrange=None,
    range_padding=0.15,
    xlab=None,
    ylab=None,
    title=None,
    legend_title=None,
    show_axes=True,
    show_tooltip=True,
    background_color=None,
    axis_color="#333333",
    legend_bg="#ffffff",
    legend_text="#000000",
    legend_position="top-right",
    draggable_legend=True,
    enable_download=False,
    font_size=12,
    legend_font_size=12,
    auto_fit=False,
    point_labels=None,
    plot_id=None,
    filter_by=None,
) -> dict:
    """Return the ``xData`` dict consumed by the bundled JS widget."""
    x_vec = np.asarray(data.x, dtype="float64")
    y_vec = np.asarray(data.y, dtype="float64")
    n = int(x_vec.shape[0])

    if xrange is None:
        xrange = _pad_range(float(np.nanmin(x_vec)), float(np.nanmax(x_vec)), range_padding)
    if yrange is None:
        yrange = _pad_range(float(np.nanmin(y_vec)), float(np.nanmax(y_vec)), range_padding)

    x_norm = _normalise_range(x_vec, xrange[0], xrange[1])
    y_norm = _normalise_range(y_vec, yrange[0], yrange[1])

    # R names the colour variable after the column when colorBy is a column
    # name, else the sentinel "Solid_Color" (R/scatterplot.R).
    color_var_name = data.color_name if data.color_name is not None else "Solid_Color"
    color_payload = _build_color_payload(
        data.color, color_var_name, legend_title, point_color,
        categorical_palette, continuous_palette, custom_palette, custom_colors,
        vmin, vmax, center_zero,
    )
    options = color_payload["options"]
    options["size"] = point_size
    options["opacity"] = opacity
    legend = color_payload["legend"]
    z = color_payload["z"]

    # encode z by its variable type, mirroring R's switch()
    z_payload = None
    if z is not None:
        vt = legend.get("var_type")
        if vt == "continuous":
            z_payload = to_base64_u16_unit(z)
        elif vt == "categorical":
            z_payload = to_base64_u16_int(z)
        else:
            z_payload = to_base64_f32(z)

    group_payload = None
    if data.group is not None:
        codes = pd.Series(data.group).astype("category").cat.codes.to_numpy().astype("int64")
        group_payload = to_base64_u16_int(codes)

    filter_payload = {}
    if filter_by is not None:
        fb = pd.DataFrame(filter_by)
        for col in fb.columns:
            filter_payload[str(col)] = to_base64_f32(fb[col].to_numpy().astype("float64"))

    margins = {"top": 20, "right": 20, "bottom": 40, "left": 50}

    return {
        "x": to_base64_u16(x_norm),
        "y": to_base64_u16(y_norm),
        "z": z_payload,
        "filter_data": filter_payload,
        "group_data": group_payload,
        "n_points": n,
        "pixelRatio": pixel_ratio,
        "options": options,
        "legend": legend,
        "x_min": xrange[0], "x_max": xrange[1],
        "y_min": yrange[0], "y_max": yrange[1],
        "xlab": xlab if xlab is not None else (data.xlab or "X"),
        "ylab": ylab if ylab is not None else (data.ylab or "Y"),
        "title": title,
        "showAxes": show_axes,
        "showTooltip": show_tooltip,
        "backgroundColor": background_color,
        "axisColor": axis_color,
        "legendBg": legend_bg,
        "legendText": legend_text,
        "legendAnchor": _resolve_legend_position(legend_position),
        "draggableLegend": bool(draggable_legend),
        "enableDownload": enable_download,
        "gene_names": [str(g) for g in point_labels] if point_labels is not None else None,
        "plotId": plot_id,
        "syncPlots": None,
        "performanceMode": n > 500000,
        "autoFit": auto_fit,
        "margins": margins,
        "fontSize": font_size,
        "legendFontSize": legend_font_size,
        "syncState": True,
        "colorVar": color_var_name,
        "groupVar": data.group_name,
    }
