#!/usr/bin/env bash
# Build the widget bundles and copy the anywidget bundle into a sibling
# reglscatterpy checkout (the Python package vendors this built artifact).
set -euo pipefail
cd "$(dirname "$0")"
npm run build
DEST="../../reglscatterpy/src/reglscatterpy/static/widget.js"
if [ -d "../../reglscatterpy" ]; then
  cp dist/widget.js "$DEST"
  echo "synced -> $DEST"
else
  echo "reglscatterpy not found at ../../reglscatterpy; built dist/widget.js only"
fi
