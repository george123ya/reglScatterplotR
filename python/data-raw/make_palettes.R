#!/usr/bin/env Rscript
# Regenerate python/src/reglscatterpy/_palettes.py from R so the Python package
# uses palettes byte-identical to reglScatterplotR (viridisLite + RColorBrewer).
#
# Run from the repo root:  Rscript python/data-raw/make_palettes.R

cont <- c("viridis", "magma", "plasma", "inferno", "cividis", "turbo")
fns <- list(
    viridis = viridisLite::viridis, magma = viridisLite::magma,
    plasma = viridisLite::plasma, inferno = viridisLite::inferno,
    cividis = viridisLite::cividis, turbo = viridisLite::turbo
)
qual <- c("Set1", "Set2", "Set3", "Dark2", "Paired", "Accent", "Pastel1", "Pastel2")

out <- "python/src/reglscatterpy/_palettes.py"
con <- file(out, "w")
writeLines(c(
    "# Auto-generated from R (viridisLite + RColorBrewer). Do not edit by hand.",
    "# Regenerate via data-raw/make_palettes.R so palettes stay pixel-identical to reglScatterplotR.",
    ""
), con)
writeLines("CONTINUOUS = {", con)
for (nm in cont) {
    hx <- substr(fns[[nm]](256L), 1, 7)
    writeLines(sprintf("    %s: [%s],", shQuote(nm), paste0("\"", hx, "\"", collapse = ", ")), con)
}
writeLines(c("}", ""), con)
writeLines("QUALITATIVE = {", con)
for (nm in qual) {
    mx <- RColorBrewer::brewer.pal.info[nm, "maxcolors"]
    hx <- substr(RColorBrewer::brewer.pal(mx, nm), 1, 7)
    writeLines(sprintf("    %s: [%s],", shQuote(nm), paste0("\"", hx, "\"", collapse = ", ")), con)
}
writeLines("}", con)
close(con)
cat("wrote", out, "\n")
