# Omni installer (Windows) — irm https://raw.githubusercontent.com/hallelx2/omni/main/install.ps1 | iex
#
# Downloads the latest prebuilt omni.exe from GitHub releases, installs it
# to ~\.omni\bin, and adds that directory to your User PATH. Override the
# version with $env:OMNI_VERSION = 'v0.1.0'.
$ErrorActionPreference = "Stop"

$repo    = "hallelx2/omni"
$binDir  = if ($env:OMNI_BIN_DIR) { $env:OMNI_BIN_DIR } else { Join-Path $HOME ".omni\bin" }
$version = if ($env:OMNI_VERSION) { $env:OMNI_VERSION } else { "latest" }

Write-Host ""
Write-Host "  ◆ omni installer" -ForegroundColor White
Write-Host ""

# ─── Detect arch ─────────────────────────────────────────────────────────────
$arch = if ([Environment]::Is64BitOperatingSystem) {
  if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
} else {
  throw "32-bit Windows is not supported"
}
$asset = "omni-windows-$arch.exe"
Write-Host "  platform: windows-$arch" -ForegroundColor DarkGray

# ─── Resolve URL ─────────────────────────────────────────────────────────────
$url = if ($version -eq "latest") {
  "https://github.com/$repo/releases/latest/download/$asset"
} else {
  "https://github.com/$repo/releases/download/$version/$asset"
}

# ─── Download ────────────────────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
$target = Join-Path $binDir "omni.exe"
Write-Host "  downloading $asset..." -ForegroundColor DarkGray
Invoke-WebRequest -Uri $url -OutFile $target -UseBasicParsing
Write-Host "  ✓ installed → $target" -ForegroundColor Green

# ─── Wire PATH (User scope, idempotent) ──────────────────────────────────────
$old = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($null -eq $old) { $old = "" }
$parts = $old.Split(";") | Where-Object { $_ -ne "" }
if ($parts -contains $binDir) {
  Write-Host "  · PATH already contains $binDir" -ForegroundColor DarkGray
} else {
  $next = (@($parts + $binDir) -join ";")
  [Environment]::SetEnvironmentVariable("PATH", $next, "User")
  Write-Host "  ✓ PATH → added $binDir to your User PATH" -ForegroundColor Green
  Write-Host "    (open a NEW terminal for it to take effect)" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "  done." -ForegroundColor White
Write-Host ""
Write-Host "  omni" -ForegroundColor Cyan
Write-Host "  put MIMO_API_KEY in ~\.omni\.env to use your Xiaomi grant" -ForegroundColor DarkGray
Write-Host "  plain REPL: omni --plain" -ForegroundColor DarkGray
Write-Host ""
