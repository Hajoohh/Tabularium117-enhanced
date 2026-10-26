# Tabularium 117 web UI

Static frontend embedded into `tabularium117.exe` via `embed` (see `embed.go`) and
served at `/`. No build step: HTML, CSS, and JavaScript ES modules only; uPlot
is vendored under `vendor/uplot/`.

Layout: `index.html` (shell), `css/app.css`, `js/app.js` (entry, router,
status bar), `js/api.js`, `js/live.js` (SSE), `js/i18n.js` (DE/EN),
`js/alerts.js`, `js/wakelock.js` (the "keep the screen on" opt-in),
`js/views/*.js` (islands, efficiency, island-header shared by both, history,
alerts, help, phone). Their logic is tested in `../scripts/ui.test.mjs`. The phone
panel (`js/views/phone.js`, route `#/phone`) is shown only when
`/api/v1/status` reports `lan.local`, i.e. to the browser on the PC itself; a
LAN client gets a small indicator in the status bar instead.
`js/goods-chains.json` is the editable, region-keyed recipe list used by the
goods search. Each chain has ordered stages, each with one or more input goods
and an output; goods are matched by catalog GUID and have German and English
display names. The optional `product` identifies the intended end product
independently of the listed stages, so incomplete recipe data can be entered
without inventing missing steps. Chain options are available in island, region,
and total goods views. Region views show the selected region's chains; the
total view can show chains from all regions. Clicking any good in a chain opens
an overview of all chains containing that good. `js/goods-icons.json`
separately maps catalog GUIDs to local image files under `production_goods`;
those assets are embedded and served by the application without contacting
third-party image hosts. New top-level directories must be added to the
`//go:embed` pattern in
`embed.go` to reach the executable. To look at the UI without the game:
`go run ./cmd/tabularium117 --replay testdata/connector-reencoded.jsonl --serve-after-replay`.
