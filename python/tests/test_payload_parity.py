"""R <-> Python payload parity.

The fixture ``fixtures/parity_expected.json`` is generated from the R package
(see ``python/tests/fixtures/README.md``). These tests assert that
``build_payload`` produces byte-identical base64 coordinates, colour/legend
payloads and ranges, so the same compiled widget renders identically whether
driven from R (htmlwidgets) or Python (anywidget).
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from reglscatterpy._extract import PlotData
from reglscatterpy._payload import build_payload

FIXTURE = Path(__file__).parent / "fixtures" / "parity_expected.json"
EXPECTED = json.loads(FIXTURE.read_text())

X = np.arange(0, 10, dtype="float64")
Y = np.arange(9, -1, -1, dtype="float64")
CAT = np.array(["a", "b", "c", "a", "b", "c", "a", "b", "c", "a"])
VAL = np.arange(0, 4.5 + 0.5, 0.5, dtype="float64")


def _pd(color=None, group=None):
    return PlotData(x=X, y=Y, color=color, group=group)


def test_case_A_categorical():
    p = build_payload(_pd(color=CAT), categorical_palette="Set1")
    e = EXPECTED["A"]
    assert p["x"] == e["x"]
    assert p["y"] == e["y"]
    assert p["z"] == e["z"]
    assert p["options"]["pointColor"] == e["pointColor"]
    assert p["options"]["colorBy"] == e["colorBy"]
    assert p["legend"]["names"] == e["legend"]["names"]
    assert p["legend"]["colors"] == e["legend"]["colors"]
    assert p["legend"]["var_type"] == "categorical"


def test_case_B_continuous():
    p = build_payload(_pd(color=VAL), continuous_palette="viridis", vmin=0, vmax=4)
    e = EXPECTED["B"]
    assert p["x"] == e["x"]
    assert p["y"] == e["y"]
    assert p["z"] == e["z"]                       # continuous u16-unit encoding
    assert p["options"]["pointColor"] == e["pointColor"]   # 256-step viridis
    assert p["legend"]["var_type"] == "continuous"
    assert p["legend"]["minVal"] == e["legend"]["minVal"]
    assert p["legend"]["maxVal"] == e["legend"]["maxVal"]
    assert p["legend"]["colors"] == e["legend"]["colors"]


def test_case_C_solid_group_filter():
    p = build_payload(_pd(group=CAT), point_color="#ff0000",
                      filter_by={"val": VAL})
    e = EXPECTED["C"]
    assert p["x"] == e["x"]
    assert p["y"] == e["y"]
    assert p["options"]["pointColor"] == e["pointColor"]
    assert p["options"]["colorBy"] == e["colorBy"]
    assert p["group_data"] == e["group_data"]
    assert p["filter_data"]["val"] == e["filter_data"]["val"]


def test_ranges_match():
    p = build_payload(_pd(color=CAT))
    e = EXPECTED["A"]
    assert p["x_min"] == pytest.approx(e["x_min"])
    assert p["x_max"] == pytest.approx(e["x_max"])
    assert p["y_min"] == pytest.approx(e["y_min"])
    assert p["y_max"] == pytest.approx(e["y_max"])
    assert p["n_points"] == e["n_points"]
