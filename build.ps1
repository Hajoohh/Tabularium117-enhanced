# Build tabularium117-enhanced.exe on Windows. Equivalent to `make build`.
$ErrorActionPreference = "Stop"

$version = "dev"
try { $version = (git describe --tags --always --dirty 2>$null); if (-not $version) { $version = "dev" } } catch {}

$env:CGO_ENABLED = "0"
$env:GOOS = "windows"
$env:GOARCH = "amd64"

New-Item -ItemType Directory -Force -Path dist | Out-Null
go build -trimpath -ldflags "-s -w -X main.version=$version" -o dist/tabularium117-enhanced.exe ./cmd/tabularium117
if ($LASTEXITCODE -ne 0) {
    throw "go build failed with exit code $LASTEXITCODE. Windows Security may have blocked the generated executable; check Protection history."
}
if (-not (Test-Path -LiteralPath "dist\tabularium117-enhanced.exe" -PathType Leaf)) {
    throw "go build reported success but dist\tabularium117-enhanced.exe was not created."
}
Write-Host "built dist/tabularium117-enhanced.exe ($version)"
