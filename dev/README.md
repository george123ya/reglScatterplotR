# dev/ - manual sandbox

Scratch scripts for exercising the package interactively. Not shipped to
users (excluded via `.Rbuildignore`).

Workflow: `devtools::load_all()` once, then source any file below.

| File                   | What it checks                                                      |
|------------------------|---------------------------------------------------------------------|
| `01_basic.R`           | Smoke test - the iris scatterplot in five lines.                    |
| `02_quantization.R`    | Round-trip the U16 encoders, eyeball precision loss.                 |
| `03_sce_integration.R` | Build a fake `SingleCellExperiment`, plot UMAP + gene colours.        |
| `04_perf_bench.R`      | The build/serialize ladder up to 5 M points; prints a table.          |
| `05_huge_data.R`       | 10 M-point stress test - saves an HTML file and opens it in Chromium. |
| `06_compare_libs.R`    | Total-HTML-time comparison with `plotly`.                            |
| `integration.Rmd`      | End-to-end Bioconductor integration tour (knit to HTML or run cells). |

Everything writes to `/tmp` so you can rerun freely.
