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
| `src/htmlwidget.js` | The widget. Static-imports the deps (bundled), then the existing IIFE registers `HTMLWidgets.widget(...)` and the Shiny message handlers. |
| `build.mjs` | esbuild config. Emits an IIFE classic script with everything inlined. |

## Roadmap — Phase 2 (shared core for Python)

`src/htmlwidget.js` is now a real ES module, which is the prerequisite for
splitting the rendering "brain" into a framework-agnostic `src/core.js` plus
thin adapters:

* `src/htmlwidget.js` → R (htmlwidgets) adapter
* `src/anywidget.js` → Python (anywidget) adapter, bundled into
  `python/src/reglscatterpy/static/`

so the R and Python packages render the *same* widget (legend, sync, lasso,
export) from one codebase. Not done yet — tracked for the next iteration.
