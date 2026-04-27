$ErrorActionPreference = 'Stop'

$mpvVersion = '0.41.0'
$mpvArch = 'x86_64'
$mpvFileName = "mpv-$mpvVersion-$mpvArch.7z"
$mpvUrl = "https://sourceforge.net/projects/mpv-player-windows/files/release/$mpvFileName/download"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$destDir = Join-Path $repoRoot 'resources\mpv'
$cacheDir = Join-Path $repoRoot '.cache\mpv'
$archivePath = Join-Path $cacheDir $mpvFileName

function Ensure-7z {
    if (Get-Command 7z -ErrorAction SilentlyContinue) {
        return
    }

    if (Get-Command choco -ErrorAction SilentlyContinue) {
        Write-Host "7z not found; installing 7zip via Chocolatey..."
        choco install 7zip -y --no-progress --limit-output
        if (Get-Command 7z -ErrorAction SilentlyContinue) {
            return
        }
    }

    throw "7z not found. Please install 7-Zip (or Chocolatey) and re-run scripts/setup-mpv.ps1"
}

Ensure-7z

New-Item -ItemType Directory -Path $destDir -Force | Out-Null
New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null

Write-Host "Downloading MPV $mpvVersion ($mpvArch) ..."
Invoke-WebRequest -Uri $mpvUrl -OutFile $archivePath -UseBasicParsing

Write-Host "Extracting to $destDir ..."
& 7z x $archivePath ("-o$destDir") -y | Out-Null

$mpvExe = Join-Path $destDir 'mpv.exe'
if (!(Test-Path $mpvExe)) {
    throw "Expected $mpvExe to exist after extraction, but it was not found."
}

Write-Host "OK: $mpvExe"

