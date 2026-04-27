$ErrorActionPreference = 'Stop'

$mpvVersion = '0.41.0'
$mpvArch = 'x86_64'
$mpvFileName = "mpv-$mpvVersion-$mpvArch.7z"
# Direct mirror — SourceForge /download often saves an HTML page in CI/headless environments.
$mpvUrl = "https://downloads.sourceforge.net/project/mpv-player-windows/release/$mpvFileName"

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
if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    curl.exe -fsSL -o $archivePath $mpvUrl
} else {
    Invoke-WebRequest -Uri $mpvUrl -OutFile $archivePath -UseBasicParsing
}

$len = (Get-Item $archivePath).Length
if ($len -lt 5MB) {
    throw "Downloaded file is too small ($len bytes); expected MPV 7z archive."
}

Write-Host "Extracting to $destDir ..."
& 7z x $archivePath ("-o$destDir") -y | Out-Null

$mpvExe = Join-Path $destDir 'mpv.exe'
if (!(Test-Path $mpvExe)) {
    throw "Expected $mpvExe to exist after extraction, but it was not found."
}

Write-Host "OK: $mpvExe"

