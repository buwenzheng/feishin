#!/usr/bin/env bash
set -euo pipefail

mpv_version="0.41.0"
mpv_arch="x86_64"
mpv_filename="mpv-${mpv_version}-${mpv_arch}.7z"
# Direct mirror — /download often returns HTML in headless/CI environments.
mpv_url="https://downloads.sourceforge.net/project/mpv-player-windows/release/${mpv_filename}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest_dir="${repo_root}/resources/mpv"
cache_dir="${repo_root}/.cache/mpv"
archive_path="${cache_dir}/${mpv_filename}"

ensure_7z() {
  if command -v 7z >/dev/null 2>&1; then
    return 0
  fi

  if command -v brew >/dev/null 2>&1; then
    echo "7z not found; installing p7zip via Homebrew..."
    brew install p7zip
    return 0
  fi

  echo "ERROR: 7z not found. Install p7zip (e.g. brew install p7zip) and re-run scripts/setup-mpv.sh" >&2
  exit 1
}

ensure_7z

mkdir -p "${dest_dir}" "${cache_dir}"

echo "Downloading MPV ${mpv_version} (${mpv_arch})..."
curl -L --fail "${mpv_url}" -o "${archive_path}"

size=$(wc -c < "${archive_path}" | tr -d ' ')
min=$((5 * 1024 * 1024))
if [[ "${size}" -lt "${min}" ]]; then
  echo "ERROR: downloaded file is too small (${size} bytes); not a valid MPV archive." >&2
  exit 1
fi

echo "Extracting to ${dest_dir}..."
7z x "${archive_path}" "-o${dest_dir}" -y >/dev/null

if [[ ! -f "${dest_dir}/mpv.exe" ]]; then
  echo "ERROR: expected ${dest_dir}/mpv.exe to exist after extraction." >&2
  exit 1
fi

echo "OK: ${dest_dir}/mpv.exe"

