# Parity fixtures

`parity_expected.json` is the **R** package's payload for three deterministic
inputs, used by `tests/test_payload_parity.py` to prove the Python
`build_payload()` produces byte-identical base64 coordinates, z-encoding,
palettes, legend and ranges.

Regenerate (from the repo root, R with the package loadable) via the snippet in
the project notes — inputs are `x = 0:9`, `y = 9:0`, `cat = a/b/c…`,
`val = seq(0, 4.5, 0.5)`, covering categorical (Set1), continuous (viridis,
vmin/vmax) and solid-colour + group + filter cases.
