#!/usr/bin/env bash
# Moves one version from the beta update feed to the release feed, so every
# install gets it. Runs when a GitHub release stops being a pre-release.
#
# Only that version is promoted: the beta feed may already list a newer beta,
# so its manifest is never copied as a whole.
set -euo pipefail

for tool in aws jq curl node; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "${tool} is required but was not found." >&2
    exit 1
  fi
done

is_safe_path_component() {
  local value="$1"
  [[ -n "$value" && "$value" =~ ^[A-Za-z0-9._/-]+$ && "$value" != *".."* && "$value" != /* ]]
}

for name in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET R2_PUBLIC_BASE_URL RELEASE_TAG; do
  if [[ -z "${!name:-}" ]]; then
    echo "${name} is required." >&2
    exit 1
  fi
done

if [[ "$R2_PUBLIC_BASE_URL" != https://* ]]; then
  echo "R2_PUBLIC_BASE_URL must start with https://." >&2
  exit 1
fi

tag="$RELEASE_TAG"
if [[ "$tag" =~ ^mac-v([0-9A-Za-z._-]+)$ ]]; then
  platform="darwin/arm64"
elif [[ "$tag" =~ ^win-v([0-9A-Za-z._-]+)$ ]]; then
  platform="win32/x64"
elif [[ "$tag" =~ ^linux-v[0-9A-Za-z._-]+$ ]]; then
  # Linux has no update feed: installs read the website's build list.
  echo "Linux has no update feed to promote."
  exit 0
else
  echo "Release tag is invalid: ${tag} (expected mac-vX.Y.Z, win-vX.Y.Z or linux-vX.Y.Z)" >&2
  exit 1
fi
version="${BASH_REMATCH[1]}"

prefix="${R2_RELEASE_PREFIX:-screenforge}"
if ! is_safe_path_component "$prefix"; then
  echo "R2_RELEASE_PREFIX is invalid." >&2
  exit 1
fi
prefix="${prefix%/}"

public_base="${R2_PUBLIC_BASE_URL%/}"
beta_path="${prefix}/updates/beta/${platform}"
release_path="${prefix}/updates/release/${platform}"
endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="auto"
export AWS_REQUEST_CHECKSUM_CALCULATION="when_required"
export AWS_RESPONSE_CHECKSUM_VALIDATION="when_required"

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

copy_to_release_feed() {
  local name="$1"
  if ! is_safe_path_component "$name" || [[ "$name" == */* ]]; then
    echo "Unsafe update feed file name: ${name}" >&2
    exit 1
  fi
  aws s3 cp "s3://${R2_BUCKET}/${beta_path}/${name}" "s3://${R2_BUCKET}/${release_path}/${name}" \
    --endpoint-url "$endpoint" \
    --only-show-errors \
    --cache-control "public, max-age=31536000, immutable"
  echo "Copied ${name} -> ${public_base}/${release_path}/${name}"
}

upload_manifest() {
  local file="$1" name="$2"
  shift 2
  aws s3 cp "$file" "s3://${R2_BUCKET}/${release_path}/${name}" \
    --endpoint-url "$endpoint" \
    --only-show-errors \
    --cache-control "public, max-age=300, must-revalidate" \
    "$@"
  echo "Uploaded ${name} -> ${public_base}/${release_path}/${name}"
}

if [[ "$platform" == "darwin/arm64" ]]; then
  # Electron Forge adds each build to the beta manifest, so it holds this version's entry.
  curl --fail --silent --show-error --location \
    "${public_base}/${beta_path}/RELEASES.json" -o "${work_dir}/beta.json"

  entry="$(jq --arg version "$version" '[.releases[]? | select(.version == $version)] | last // empty' "${work_dir}/beta.json")"
  if [[ -z "$entry" ]]; then
    # Built before the beta feed existed: such builds went straight to the release feed.
    if curl --fail --silent --location "${public_base}/${release_path}/RELEASES.json" |
      jq -e --arg version "$version" 'any(.releases[]?; .version == $version)' >/dev/null; then
      echo "Version ${version} is already in the macOS release feed."
      exit 0
    fi
    echo "Version ${version} is not in the macOS beta feed; nothing to promote." >&2
    exit 1
  fi

  zip_name="$(jq -r '.updateTo.url | split("/") | last' <<<"$entry")"
  copy_to_release_feed "$zip_name"

  # The release manifest keeps its other versions and points at its own copy of the zip.
  if ! curl --fail --silent --location "${public_base}/${release_path}/RELEASES.json" \
    -o "${work_dir}/release.json"; then
    echo '{"currentRelease":"","releases":[]}' > "${work_dir}/release.json"
  fi

  jq \
    --arg version "$version" \
    --arg url "${public_base}/${release_path}/${zip_name}" \
    --argjson entry "$entry" \
    '.releases = ([.releases[]? | select(.version != $version)] + [$entry | .updateTo.url = $url])
      | .currentRelease = $version' \
    "${work_dir}/release.json" > "${work_dir}/RELEASES.json"

  upload_manifest "${work_dir}/RELEASES.json" "RELEASES.json" --content-type "application/json"
else
  # The beta feed's RELEASES belongs to its newest build; this version's copy is kept with its tag.
  if ! curl --fail --silent --show-error --location \
    "${public_base}/${prefix}/${tag}/RELEASES" -o "${work_dir}/RELEASES"; then
    # Built before the beta feed existed: such builds went straight to the release feed.
    if curl --fail --silent --location "${public_base}/${release_path}/RELEASES" |
      grep -q -- "-${version}-full\.nupkg"; then
      echo "Version ${version} is already in the Windows release feed."
      exit 0
    fi
    echo "No RELEASES file was kept for ${tag}; nothing to promote." >&2
    exit 1
  fi

  packages=()
  while IFS= read -r name; do
    packages+=("$name")
  done < <(awk 'NF >= 2 && $2 ~ /\.nupkg$/ { print $2 }' "${work_dir}/RELEASES")

  if (( ${#packages[@]} == 0 )); then
    echo "The RELEASES file for ${tag} lists no packages." >&2
    exit 1
  fi

  for name in "${packages[@]}"; do
    copy_to_release_feed "$name"
  done

  upload_manifest "${work_dir}/RELEASES" "RELEASES"

  # Windows builds up to 0.10.0 read <feed>/RELEASES/RELEASES and look for
  # packages next to it (see scripts/legacy-win-feed.mjs). Put a copy there
  # that points at the release feed's packages, so those installs update too.
  node "$(dirname "$0")/legacy-win-feed.mjs" "${work_dir}/RELEASES" \
    "${public_base}/${release_path}" "${work_dir}/legacy-RELEASES"
  upload_manifest "${work_dir}/legacy-RELEASES" "RELEASES/RELEASES"
fi

echo "Promoted ${tag} to the release feed."
