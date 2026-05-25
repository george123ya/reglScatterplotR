## dev/02_quantization.R - verify the U16 encoders round-trip cleanly.

library(reglScatterplot)

decode_u16 <- function(b64, prefix, scale = 1, offset = 0) {
    body <- sub(paste0("^", prefix), "", b64)
    raw  <- base64enc::base64decode(body)
    u16  <- readBin(raw, integer(), n = length(raw) / 2L,
                    size = 2L, signed = FALSE, endian = "little")
    (u16 / scale) + offset
}

## ---- Bipolar [-1, 1] (X / Y) -----------------------------------------------
x <- seq(-1, 1, length.out = 1001)
b <- reglScatterplot:::.toBase64U16(x)
xback <- decode_u16(b, "base64u16:", scale = 32767.5, offset = -1)
cat(sprintf("[-1, 1]  max abs error: %.2e\n", max(abs(xback - x))))

## ---- Unit [0, 1] (continuous z) --------------------------------------------
u <- seq(0, 1, length.out = 1001)
b <- reglScatterplot:::.toBase64U16Unit(u)
uback <- decode_u16(b, "base64u16u:", scale = 65535, offset = 0)
cat(sprintf("[0, 1]   max abs error: %.2e\n", max(abs(uback - u))))

## ---- Integer (categorical z) -----------------------------------------------
i <- as.integer(c(0, 1, 5, 99, 65535))
b <- reglScatterplot:::.toBase64U16Int(i)
iback <- decode_u16(b, "base64u16i:", scale = 1, offset = 0)
stopifnot(identical(as.integer(iback), i))
cat("[int]    exact round-trip OK\n")

## ---- Eyeball precision loss on a real plot ---------------------------------
set.seed(1)
df <- data.frame(x = rnorm(100000), y = rnorm(100000), v = runif(100000))
w  <- reglScatterplot(df, x = "x", y = "y", colorBy = "v",
                      continuousPalette = "magma", width = 900, height = 600)
htmlwidgets::saveWidget(w, "/tmp/quant_check.html", selfcontained = TRUE)
cat("→ /tmp/quant_check.html\n")
