#!/usr/bin/env bash
set -euo pipefail

SRC=ResearchPaper.tex
BUILD=build

mkdir -p "$BUILD"
# run latexmk; adjust engine via flags if you want xelatex/lualatex
latexmk -pdf -output-directory="$BUILD" "$SRC"

# copy resulting PDF next to source (so it's easy to view locally)
cp "$BUILD"/ResearchPaper.pdf ResearchPaper.pdf

# optional: clean aux in the build folder while keeping the PDF
# latexmk -c -output-directory="$BUILD" "$BUILD/ResearchPaper"