#!/usr/bin/env bash
set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required but was not found." >&2
  exit 1
fi

is_safe_path_component() {
  local value="$1"
  [[ -n "$value" && "$value" =~ ^[A-Za-z0-9._/-]+$ && "$value" != *".."* && "$value" != /* ]]
}

# Picks the best download artifact for a given platform from a list of candidate names.
select_preferred_release_asset() {
  local platform="$1"
  shift
  local candidates=("$@")

  if [[ "$platform" == "darwin" ]]; then
    for candidate in "${candidates[@]}"; do
      [[ "$candidate" == *.dmg && "$candidate" == *arm64* ]] && printf '%s\n' "$candidate" && return 0
    done
    for candidate in "${candidates[@]}"; do
      [[ "$candidate" == *.dmg ]] && printf '%s\n' "$candidate" && return 0
    done
    for candidate in "${candidates[@]}"; do
      [[ "$candidate" == *.zip && "$candidate" == *arm64* ]] && printf '%s\n' "$candidate" && return 0
    done
    for candidate in "${candidates[@]}"; do
      [[ "$candidate" == *.zip ]] && printf '%s\n' "$candidate" && return 0
    done
  elif [[ "$platform" == "win32" ]]; then
    for candidate in "${candidates[@]}"; do
      [[ "$candidate" == *.exe ]] && printf '%s\n' "$candidate" && return 0
    done
    for candidate in "${candidates[@]}"; do
      [[ "$candidate" == *.zip ]] && printf '%s\n' "$candidate" && return 0
    done
  fi

  return 1
}

extract_version_changelog() {
  local version="$1"
  local changelog_file="${CHANGELOG_FILE:-CHANGELOG.md}"

  if [[ ! -f "$changelog_file" ]]; then
    return 1
  fi

  awk -v version="$version" '
    $0 == "## " version {
      in_section = 1
    }
    in_section && /^## / {
      if ($0 == "## " version) {
        print
        next
      }
      exit
    }
    in_section {
      print
    }
  ' "$changelog_file"
}

trim_surrounding_blank_lines() {
  awk '
    NF {
      if (started) {
        printf "\n"
      }
      printf "%s", $0
      started = 1
    }
  '
}

if [[ -z "${GITHUB_EVENT_PATH:-}" ]]; then
  echo "GITHUB_EVENT_PATH is required." >&2
  exit 1
fi

if [[ -z "${SERVER_BASE_URL:-}" || -z "${INTERNAL_API_TOKEN:-}" ]]; then
  echo "SERVER_BASE_URL and INTERNAL_API_TOKEN are required." >&2
  exit 1
fi

if [[ -z "${R2_PUBLIC_BASE_URL:-}" ]]; then
  echo "R2_PUBLIC_BASE_URL is required." >&2
  exit 1
fi

if [[ "$R2_PUBLIC_BASE_URL" != https://* ]]; then
  echo "R2_PUBLIC_BASE_URL must start with https://." >&2
  exit 1
fi

if [[ "$SERVER_BASE_URL" != https://* ]]; then
  echo "SERVER_BASE_URL must start with https://." >&2
  exit 1
fi

server_webhook_path="${SERVER_RELEASE_WEBHOOK_PATH:-/v1/app/release/webhook}"
if [[ "$server_webhook_path" != /* ]]; then
  echo "SERVER_RELEASE_WEBHOOK_PATH must begin with '/'." >&2
  exit 1
fi

server_webhook_url="${SERVER_BASE_URL%/}${server_webhook_path}"

event_action="$(jq -r '.action // empty' "$GITHUB_EVENT_PATH")"
if [[ "$event_action" != "published" ]]; then
  echo "Skipping webhook: release action '${event_action}' is not 'published'."
  exit 0
fi

tag="$(jq -r '.release.tag_name // empty' "$GITHUB_EVENT_PATH")"
if [[ -z "$tag" ]]; then
  echo "Release tag_name is missing." >&2
  exit 1
fi

# Detect platform and extract version from tag prefix
if [[ "$tag" =~ ^mac-v[0-9A-Za-z._-]+$ ]]; then
  platform="darwin"
  arch="arm64"
  version="${tag#mac-v}"
elif [[ "$tag" =~ ^win-v[0-9A-Za-z._-]+$ ]]; then
  platform="win32"
  arch="x64"
  version="${tag#win-v}"
else
  echo "Release tag_name is invalid: ${tag} (expected mac-vX.Y.Z or win-vX.Y.Z)" >&2
  exit 1
fi

prefix="${R2_RELEASE_PREFIX:-screenforge}"
if ! is_safe_path_component "$prefix"; then
  echo "R2_RELEASE_PREFIX is invalid." >&2
  exit 1
fi

public_base="${R2_PUBLIC_BASE_URL%/}"
release_path="${prefix%/}/${tag}"
checksums_url="${public_base}/${release_path}/SHA256SUMS"

checksums_content="$(curl --fail --silent --show-error --location "$checksums_url")"

# Collect release assets from the GitHub event, filtered by platform
release_assets=()
while IFS= read -r asset; do
  release_assets+=("$asset")
done < <(
  if [[ "$platform" == "darwin" ]]; then
    jq -r '.release.assets[]? | .name // empty | select(endswith(".dmg") or endswith(".zip"))' "$GITHUB_EVENT_PATH"
  else
    jq -r '.release.assets[]? | .name // empty | select(endswith(".exe") or endswith(".zip"))' "$GITHUB_EVENT_PATH"
  fi
)

artifact_name=""
if (( ${#release_assets[@]} > 0 )); then
  artifact_name="$(select_preferred_release_asset "$platform" "${release_assets[@]}")"
else
  echo "No matching assets found on release; falling back to SHA256SUMS entries."
  checksum_artifact_names=()
  while IFS= read -r name; do
    checksum_artifact_names+=("$name")
  done < <(
    awk '
      {
        candidate=$2
        sub(/^\*/, "", candidate)
        sub(/^.*\//, "", candidate)
        if (candidate ~ /\.(dmg|zip|exe)$/) {
          print candidate
        }
      }
    ' <<<"$checksums_content"
  )

  if (( ${#checksum_artifact_names[@]} == 0 )); then
    echo "No matching entries found in SHA256SUMS." >&2
    exit 1
  fi

  artifact_name="$(select_preferred_release_asset "$platform" "${checksum_artifact_names[@]}")"
fi

if [[ -z "$artifact_name" ]]; then
  echo "Could not select a release artifact from the published assets." >&2
  exit 1
fi

if ! is_safe_path_component "$artifact_name"; then
  echo "Release artifact name is unsafe: ${artifact_name}" >&2
  exit 1
fi

download_url="${public_base}/${release_path}/${artifact_name}"
sha256="$(
  awk -v file="$artifact_name" '
    {
      candidate=$2
      sub(/^\*/, "", candidate)
      sub(/^.*\//, "", candidate)
      if (candidate == file) {
        print $1
        exit
      }
    }
  ' <<<"$checksums_content"
)"

if [[ -z "$sha256" ]]; then
  echo "Could not find checksum for ${artifact_name} inside SHA256SUMS." >&2
  exit 1
fi
if [[ ! "$sha256" =~ ^[A-Fa-f0-9]{64}$ ]]; then
  echo "Checksum for ${artifact_name} is invalid: ${sha256}" >&2
  exit 1
fi

release_notes_url="$(jq -r '.release.html_url // empty' "$GITHUB_EVENT_PATH")"
published_at="$(jq -r '.release.published_at // empty' "$GITHUB_EVENT_PATH")"
changelog="$(extract_version_changelog "$version" | trim_surrounding_blank_lines || true)"

if [[ -z "${changelog}" ]]; then
  changelog="$(jq -r '.release.body // empty' "$GITHUB_EVENT_PATH")"
fi

if [[ -z "${changelog}" ]]; then
  echo "No changelog found in CHANGELOG.md or release body for version ${version}." >&2
  exit 1
fi

payload="$(
  jq -n \
    --arg event "release.published" \
    --arg version "$version" \
    --arg tag "$tag" \
    --arg channel "stable" \
    --arg platform "$platform" \
    --arg arch "$arch" \
    --arg downloadUrl "$download_url" \
    --arg sha256 "$sha256" \
    --arg releaseNotesUrl "$release_notes_url" \
    --arg publishedAt "$published_at" \
    --arg changelog "$changelog" \
    '{
      event: $event,
      version: $version,
      tag: $tag,
      channel: $channel,
      platform: $platform,
      arch: $arch,
      downloadUrl: $downloadUrl,
      sha256: $sha256,
      releaseNotesUrl: $releaseNotesUrl,
      publishedAt: $publishedAt,
      changelog: $changelog
    }'
)"

response_file="$(mktemp)"
trap 'rm -f "$response_file"' EXIT

max_attempts=5
attempt=1

while (( attempt <= max_attempts )); do
  http_code="$(
    curl \
      --silent \
      --show-error \
      --output "$response_file" \
      --write-out "%{http_code}" \
      --request POST \
      --header "Content-Type: application/json" \
      --header "x-internal-api-key: ${INTERNAL_API_TOKEN}" \
      --header "User-Agent: screenforge-release-webhook" \
      --data "$payload" \
      "$server_webhook_url" || true
  )"

  if [[ "$http_code" =~ ^2[0-9][0-9]$ ]]; then
    echo "Update server webhook delivered successfully."
    exit 0
  fi

  if [[ "$http_code" == "000" || "$http_code" == "408" || "$http_code" == "425" || "$http_code" == "429" || "$http_code" =~ ^5[0-9][0-9]$ ]]; then
    if (( attempt < max_attempts )); then
      sleep_seconds=$((attempt * 2))
      echo "Transient webhook failure (HTTP ${http_code:-none}), retrying in ${sleep_seconds}s..."
      sleep "$sleep_seconds"
      attempt=$((attempt + 1))
      continue
    fi
  fi

  echo "Webhook request failed with HTTP ${http_code:-none}." >&2
  if [[ -s "$response_file" ]]; then
    echo "Response body:" >&2
    cat "$response_file" >&2
  fi
  exit 1
done

echo "Webhook request failed after ${max_attempts} attempts." >&2
if [[ -s "$response_file" ]]; then
  echo "Response body:" >&2
  cat "$response_file" >&2
fi
exit 1
