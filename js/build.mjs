// Build the reglScatterplot widget bundles.
//
//   * R htmlwidget  -> ../inst/htmlwidgets/reglScatterplot.js   (IIFE, classic
//     script loaded by htmlwidgets; HTMLWidgets/Shiny are runtime globals)
//
// All browser dependencies (d3, regl-scatterplot, pickr, html2canvas, jspdf)
// are bundled in, so the widget never reaches out to a CDN at runtime - it
// works fully offline, in standalone HTML reports, and behind firewalls.
//
// Run with:  npm install && npm run build
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  platform: "browser",
  target: ["es2019"],
  minify: true,
  legalComments: "none",
  loader: { ".css": "text" },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
};

const builds = [
  {
    ...shared,
    entryPoints: ["src/htmlwidget.js"],
    outfile: "../inst/htmlwidgets/reglScatterplot.js",
    format: "iife",
    // HTMLWidgets and Shiny are provided by the htmlwidgets runtime; never try
    // to resolve them from node_modules.
    banner: { js: "/* reglScatterplot widget - bundled, no CDN. Source: js/src/ */" },
  },
];

if (watch) {
  for (const cfg of builds) {
    const ctx = await esbuild.context(cfg);
    await ctx.watch();
  }
  console.log("watching...");
} else {
  await Promise.all(builds.map((cfg) => esbuild.build(cfg)));
  console.log("build complete");
}
