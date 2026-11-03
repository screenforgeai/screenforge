# build-native-windows.ps1
# Builds ScreenforgeCapture.exe (native Windows capture helper) using CMake.
# Run from the repo root: powershell -File scripts/build-native-windows.ps1

param(
    [string]$Config = "Release"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot   = Split-Path -Parent $PSScriptRoot
$SourceDir  = Join-Path $RepoRoot "native\windows\ScreenforgeCapture"
$BuildDir   = Join-Path $RepoRoot "build\windows"
$OutputDir  = Join-Path $RepoRoot "native\bin\win32-x64"

# Auto-detect the installed Visual Studio generator rather than hardcoding a version.
Write-Host "==> Configuring CMake..." -ForegroundColor Cyan
cmake -B $BuildDir -A x64 -S $SourceDir
if ($LASTEXITCODE -ne 0) { throw "CMake configure failed" }

Write-Host "==> Building ($Config)..." -ForegroundColor Cyan
cmake --build $BuildDir --config $Config
if ($LASTEXITCODE -ne 0) { throw "CMake build failed" }

$Exe = Join-Path $OutputDir "ScreenforgeCapture.exe"
if (Test-Path $Exe) {
    Write-Host "==> Built: $Exe" -ForegroundColor Green
} else {
    throw "Build succeeded but ScreenforgeCapture.exe not found at: $Exe"
}
