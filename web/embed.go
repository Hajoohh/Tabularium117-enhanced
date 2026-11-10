// Package web holds the browser UI and embeds it into the executable.
//
// The files here are plain HTML, CSS and ES modules; there is no build step
// (KONZEPT.md section 3). internal/server serves this file system at "/".
package web

import "embed"

// FS holds the UI files, with index.html at its root: the stylesheet, the ES
// modules, the vendored uPlot, and icons from web/production_goods next to it.
// The similarly named repository-root directory is not embedded.
//
//go:embed index.html css js vendor production_goods
var FS embed.FS
