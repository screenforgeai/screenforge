#!/usr/bin/env bash
set -euo pipefail

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "This script must run inside a git repository." >&2
  exit 1
fi

if ! git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
  # A repository's first commit lists every file as changed, including
  # versions.json, which would re-tag (and re-release) existing versions.
  echo "Skipping tag creation: first commit, nothing was version-bumped."
  exit 0
fi
changed_files="$(git diff --name-only HEAD~1..HEAD)"

# Require at least versions.json or package.json + CHANGELOG.md to have changed
versions_changed=false
pkg_changelog_changed=false

if grep -qx "versions.json" <<<"$changed_files"; then
  versions_changed=true
fi
if grep -qx "package.json" <<<"$changed_files" && grep -qx "CHANGELOG.md" <<<"$changed_files"; then
  pkg_changelog_changed=true
fi

if [[ "$versions_changed" == "false" && "$pkg_changelog_changed" == "false" ]]; then
  echo "Skipping tag creation: neither versions.json nor (package.json + CHANGELOG.md) were updated on this push."
  exit 0
fi

mac_version="$(node -p "require('./versions.json').mac")"
win_version="$(node -p "require('./versions.json').win")"
linux_version="$(node -p "require('./versions.json').linux")"
mac_tag="mac-v${mac_version}"
win_tag="win-v${win_version}"
linux_tag="linux-v${linux_version}"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

dispatch_workflow() {
  local workflow="$1"
  local tag="$2"

  if [[ "${GITHUB_ACTIONS:-}" != "true" ]]; then
    return 0
  fi

  if [[ -z "${GITHUB_TOKEN:-}" || -z "${GITHUB_REPOSITORY:-}" ]]; then
    echo "GITHUB_TOKEN and GITHUB_REPOSITORY are required to dispatch workflow." >&2
    exit 1
  fi

  local api_url="${GITHUB_API_URL:-https://api.github.com}"
  local dispatch_ref="${GITHUB_REF_NAME:-main}"
  local payload
  payload="$(printf '{"ref":"%s","inputs":{"tag":"%s"}}' "$dispatch_ref" "$tag")"

  echo "Dispatching ${workflow} for ${tag}"
  curl --fail --silent --show-error \
    --request POST \
    --header "Authorization: Bearer ${GITHUB_TOKEN}" \
    --header "Accept: application/vnd.github+json" \
    --header "Content-Type: application/json" \
    --data "$payload" \
    "${api_url}/repos/${GITHUB_REPOSITORY}/actions/workflows/${workflow}/dispatches" >/dev/null
}

create_and_push_tag() {
  local tag="$1"
  if git rev-parse "$tag" >/dev/null 2>&1; then
    echo "Tag ${tag} already exists. Skipping."
    return 1  # signals "already existed"
  fi
  echo "Creating and pushing tag ${tag}"
  git tag "$tag"
  git push origin "$tag"
  return 0
}

# Determine which platforms had their version changed
mac_tag_new=false
win_tag_new=false
linux_tag_new=false

if create_and_push_tag "$mac_tag"; then
  mac_tag_new=true
fi

if create_and_push_tag "$win_tag"; then
  win_tag_new=true
fi

if create_and_push_tag "$linux_tag"; then
  linux_tag_new=true
fi

# Dispatch only the workflows whose tag is new (avoids re-triggering existing releases)
if [[ "$mac_tag_new" == "true" ]]; then
  dispatch_workflow "release.yml" "$mac_tag"
fi

if [[ "$win_tag_new" == "true" ]]; then
  dispatch_workflow "build-windows.yml" "$win_tag"
fi

if [[ "$linux_tag_new" == "true" ]]; then
  dispatch_workflow "build-linux.yml" "$linux_tag"
fi

if [[ "$mac_tag_new" == "false" && "$win_tag_new" == "false" && "$linux_tag_new" == "false" ]]; then
  echo "All tags already exist — no workflows dispatched."
fi
