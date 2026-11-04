#!/usr/bin/env bash
set -euo pipefail

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required but was not found." >&2
  exit 1
fi

is_safe_path_component() {
  local value="$1"
  [[ -n "$value" && "$value" =~ ^[A-Za-z0-9._/-]+$ && "$value" != *".."* && "$value" != /* ]]
}

required_env=(
  R2_ACCOUNT_ID
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
  R2_BUCKET
  R2_PUBLIC_BASE_URL
)

for name in "${required_env[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "${name} is required." >&2
    exit 1
  fi
done

tag="${R2_RELEASE_TAG:-${GITHUB_REF##*/}}"
if [[ -z "$tag" || ! "$tag" =~ ^([A-Za-z]+-)?v[0-9A-Za-z._-]+$ ]]; then
  echo "A tag in the format vX.Y.Z or {platform}-vX.Y.Z is required for R2 upload." >&2
  exit 1
fi

prefix="${R2_RELEASE_PREFIX:-screenforge}"
if ! is_safe_path_component "$prefix"; then
  echo "R2_RELEASE_PREFIX is invalid. Use only letters, numbers, '.', '_', '-', '/'." >&2
  exit 1
fi

if [[ "$R2_PUBLIC_BASE_URL" != https://* ]]; then
  echo "R2_PUBLIC_BASE_URL must start with https://." >&2
  exit 1
fi

release_path="${prefix%/}/${tag}"
mac_update_feed_path="${prefix%/}/updates/release/darwin/arm64"
public_base="${R2_PUBLIC_BASE_URL%/}"
endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="auto"
# Recent AWS CLI versions add CRC checksums to multipart uploads by default,
# which R2 can reject (InvalidPart on CompleteMultipartUpload). Only send
# checksums when an API requires them, as Cloudflare recommends for R2.
export AWS_REQUEST_CHECKSUM_CALCULATION="when_required"
export AWS_RESPONSE_CHECKSUM_VALIDATION="when_required"

artifact_files=()
while IFS= read -r file; do
  artifact_files+=("$file")
done < <(find out/make -type f \( -name "*.dmg" -o -name "*.zip" \) | sort)

if (( ${#artifact_files[@]} == 0 )); then
  echo "No release artifacts found under out/make." >&2
  exit 1
fi

if [[ ! -f out/make/SHA256SUMS ]]; then
  echo "out/make/SHA256SUMS is missing." >&2
  exit 1
fi

mac_feed_artifacts=()
while IFS= read -r file; do
  mac_feed_artifacts+=("$file")
done < <(find out/make/zip/darwin/arm64 -maxdepth 1 -type f -name "*.zip" | sort)

if (( ${#mac_feed_artifacts[@]} == 0 )); then
  echo "No macOS updater zip artifacts found under out/make/zip/darwin/arm64." >&2
  exit 1
fi

mac_releases_manifest="out/make/zip/darwin/arm64/RELEASES.json"
if [[ ! -f "$mac_releases_manifest" ]]; then
  echo "macOS updater manifest is missing at ${mac_releases_manifest}." >&2
  exit 1
fi

has_dmg=false
for file in "${artifact_files[@]}"; do
  if [[ "$file" == *.dmg ]]; then
    has_dmg=true
    break
  fi
done

if [[ "$has_dmg" != "true" ]]; then
  echo "No .dmg files found under out/make." >&2
  exit 1
fi

for file in "${artifact_files[@]}"; do
  name="$(basename "$file")"
  if ! is_safe_path_component "$name"; then
    echo "Unsafe release artifact name detected: ${name}" >&2
    exit 1
  fi
  object_key="${release_path}/${name}"
  aws s3 cp "$file" "s3://${R2_BUCKET}/${object_key}" \
    --endpoint-url "$endpoint" \
    --only-show-errors \
    --cache-control "public, max-age=31536000, immutable"
  echo "Uploaded ${name} -> ${public_base}/${object_key}"
done

aws s3 cp out/make/SHA256SUMS "s3://${R2_BUCKET}/${release_path}/SHA256SUMS" \
  --endpoint-url "$endpoint" \
  --only-show-errors \
  --cache-control "public, max-age=300, must-revalidate"

echo "Uploaded SHA256SUMS -> ${public_base}/${release_path}/SHA256SUMS"

for file in "${mac_feed_artifacts[@]}"; do
  name="$(basename "$file")"
  if ! is_safe_path_component "$name"; then
    echo "Unsafe updater artifact name detected: ${name}" >&2
    exit 1
  fi

  object_key="${mac_update_feed_path}/${name}"
  aws s3 cp "$file" "s3://${R2_BUCKET}/${object_key}" \
    --endpoint-url "$endpoint" \
    --only-show-errors \
    --cache-control "public, max-age=31536000, immutable"
  echo "Uploaded updater zip ${name} -> ${public_base}/${object_key}"
done

aws s3 cp "$mac_releases_manifest" "s3://${R2_BUCKET}/${mac_update_feed_path}/RELEASES.json" \
  --endpoint-url "$endpoint" \
  --only-show-errors \
  --cache-control "public, max-age=300, must-revalidate" \
  --content-type "application/json"

echo "Uploaded updater manifest -> ${public_base}/${mac_update_feed_path}/RELEASES.json"
