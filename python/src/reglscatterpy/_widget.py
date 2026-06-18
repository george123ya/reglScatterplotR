"""The anywidget that renders the shared reglScatterplot widget.

``static/widget.js`` is an ESM bundle built from ``js/src/anywidget.js`` (see
the repo's ``js/`` directory). It loads the *same* compiled widget the R package
uses via a tiny ``HTMLWidgets`` shim and drives it directly, so a plot looks and
behaves identically whether created from R (htmlwidgets) or Python (anywidget):
the draggable legend, lasso, tooltips, sync and PNG/SVG/PDF export all come from
one codebase.

The Python side hands the widget a ``_spec`` dict built by
:func:`reglscatterpy._payload.build_payload`, which is a byte-for-byte port of
the R payload (locked down by ``tests/test_payload_parity``).
"""

from __future__ import annotations

import pathlib

__all__ = ["ReglScatter"]

_STATIC = pathlib.Path(__file__).parent / "static" / "widget.js"


def _make_class():
    try:
        import anywidget
        import traitlets
    except ModuleNotFoundError as exc:  # pragma: no cover - import guard
        raise ModuleNotFoundError(
            "reglscatterpy's default renderer needs 'anywidget'. "
            "Install with: pip install reglscatterpy"
        ) from exc

    class ReglScatter(anywidget.AnyWidget):
        _esm = _STATIC
        _spec = traitlets.Dict().tag(sync=True)
        _height = traitlets.Int(500).tag(sync=True)
        # 0 => responsive (100% of the cell); a positive value => fixed px width.
        _width = traitlets.Int(0).tag(sync=True)

        def update(self, spec: dict) -> "ReglScatter":
            """Swap in a new payload and re-render in place."""
            self._spec = spec
            return self

    return ReglScatter


# Lazily built so importing reglscatterpy (e.g. just for `extract`) does not hard
# require anywidget; the class is created on first use.
_CLASS = None


def ReglScatter(*args, **kwargs):  # noqa: N802 - factory mimics a class
    global _CLASS
    if _CLASS is None:
        _CLASS = _make_class()
    return _CLASS(*args, **kwargs)
