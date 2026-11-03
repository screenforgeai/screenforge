#!/usr/bin/env bash
set -euo pipefail

# Uploads Linux release artifacts (.deb, .rpm, AppImage, .zip) and SHA256SUMS
# to R2 under <prefix>/<tag>/. Linux has no in-app updater, so unlike macOS and
# Windows there is no update feed to publish.

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
if [[ -z "$tag" || ! "$tag" =~ ^linux-v[0-9A-Za-z._-]+$ ]]; then
  echo "A tag in the format linux-vX.Y.Z is required for R2 upload." >&2
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
public_base="${R2_PUBLIC_BASE_URL%/}"
endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="auto"

artifact_files=()
while IFS= read -r file; do
  artifact_files+=("$file")
done < <(find out/make -type f \( -name "*.deb" -o -name "*.rpm" -o -name "*.AppImage" -o -name "*.zip" \) | sort)

if (( ${#artifact_files[@]} == 0 )); then
  echo "No release artifacts (.deb, .rpm, .AppImage, .zip) found under out/make." >&2
  exit 1
fi

if [[ ! -f out/make/SHA256SUMS ]]; then
  echo "out/make/SHA256SUMS is missing." >&2
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
