# js/ — widget build sources

The browser-side widget. All dependencies are **bundled locally** with
[esbuild](https://esbuild.github.io/) so the shipped widget never contacts a
CDN at runtime — it works offline, in self-contained HTML reports, in the
RStudio Viewer, and behind firewalls. (Previously d3, regl-scatterplot, pickr,
html2canvas and jspdf were pulled from esm.sh / cdnjs via dynamic `import()`
and `<script>` injection, so rendering silently needed a network.)

This directory is excluded from the R build (`.Rbuildignore`); only the built
artifact in `inst/htmlwidgets/` ships.

## Build

```bash
cd js
npm install
npm run build      # writes ../inst/htmlwidgets/reglScatterplot.js
npm run watch      # rebuild on change
```

## Layout

| File | Role |
|------|------|
| `src/htmlwidget.js` | The widget (the shared rendering "brain"). Static-imports the deps (bundled), then the IIFE registers `HTMLWidgets.widget(...)` and the Shiny message handlers. |
| `src/htmlwidgets-shim.js` | Minimal `HTMLWidgets` global so the widget registers under anywidget too. |
| `src/anywidget.js` | Python (anywidget) adapter — loads the shim + the widget and drives it directly. |
| `build.mjs` | esbuild config. Emits two bundles (see below). |
| `sync-python.sh` | Build, then copy the anywidget bundle into a sibling `reglscatterpy` checkout. |

## Two bundles, one source

`npm run build` emits:

* `../inst/htmlwidgets/reglScatterplot.js` — IIFE for the R package (this repo).
* `dist/widget.js` — ESM for the Python package
  ([**reglscatterpy**](https://github.com/george123ya/reglscatterpy), a separate
  repo). Run `./sync-python.sh` to copy it into a sibling checkout; the Python
  package commits it as a vendored artifact.

So R (htmlwidgets) and Python (anywidget) render the *same* widget — legend,
sync, lasso, filter sliders, export — from this one codebase. `dist/` is a build
artifact and is git-ignored.
