#!/usr/bin/env bash
# Ships a version that is on the beta channel to everyone, on every platform:
#   scripts/promote-release.sh 0.12.0
# Turns its GitHub releases (mac-v, win-v, linux-v) from pre-releases into
# releases; the Update Server Sync workflow then moves the version to the
# release update feed and lists it on the website.
#
# Run it with your own gh login: edits made with a workflow's GITHUB_TOKEN
# don't start other workflows, so the promotion would never run.
set -euo pipefail

version="${1:-}"
version="${version#v}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: scripts/promote-release.sh X.Y.Z" >&2
  exit 1
fi

for platform in mac win linux; do
  tag="${platform}-v${version}"
  if ! gh release view "$tag" --json isDraft,isPrerelease >/dev/null 2>&1; then
    echo "No release ${tag}; skipping."
    continue
  fi
  state="$(gh release view "$tag" --json isDraft,isPrerelease --jq '"\(.isDraft) \(.isPrerelease)"')"
  case "$state" in
    "true "*) echo "${tag} is still a draft: publish it (to beta) first." >&2; exit 1 ;;
    "false false") echo "${tag} already reaches everyone." ;;
    *)
      gh release edit "$tag" --prerelease=false
      echo "Promoted ${tag}."
      ;;
  esac
done
