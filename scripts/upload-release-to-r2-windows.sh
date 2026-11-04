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
if [[ -z "$tag" || ! "$tag" =~ ^win-v[0-9A-Za-z._-]+$ ]]; then
  echo "A tag in the format win-vX.Y.Z is required for R2 upload." >&2
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
win_update_feed_path="${prefix%/}/updates/release/win32/x64"
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

# Collect release artifacts (.exe installer + .zip portable)
artifact_files=()
while IFS= read -r file; do
  artifact_files+=("$file")
done < <(find out/make -type f \( -name "*.exe" -o -name "*.zip" \) | grep -v "squirrel.windows" | sort)

# Also include the setup installer from squirrel output
while IFS= read -r file; do
  artifact_files+=("$file")
done < <(find out/make/squirrel.windows -type f -name "ScreenforgeSetup.exe" 2>/dev/null | sort)

if (( ${#artifact_files[@]} == 0 )); then
  echo "No release artifacts (.exe, .zip) found under out/make." >&2
  exit 1
fi

if [[ ! -f out/make/SHA256SUMS ]]; then
  echo "out/make/SHA256SUMS is missing." >&2
  exit 1
fi

# Collect Squirrel update feed files (RELEASES + .nupkg)
win_feed_artifacts=()
while IFS= read -r file; do
  win_feed_artifacts+=("$file")
done < <(find out/make/squirrel.windows/x64 -maxdepth 1 -type f \( -name "RELEASES" -o -name "*.nupkg" \) 2>/dev/null | sort)

if (( ${#win_feed_artifacts[@]} == 0 )); then
  echo "No Windows update feed artifacts found under out/make/squirrel.windows/x64." >&2
  exit 1
fi

# Upload release artifacts (installer + portable zip + checksums)
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

# Upload Squirrel update feed (RELEASES + .nupkg) to the auto-update path
for file in "${win_feed_artifacts[@]}"; do
  name="$(basename "$file")"
  if ! is_safe_path_component "$name"; then
    echo "Unsafe update feed artifact name detected: ${name}" >&2
    exit 1
  fi
  object_key="${win_update_feed_path}/${name}"
  cache_control="public, max-age=31536000, immutable"
  if [[ "$name" == "RELEASES" ]]; then
    cache_control="public, max-age=300, must-revalidate"
  fi
  aws s3 cp "$file" "s3://${R2_BUCKET}/${object_key}" \
    --endpoint-url "$endpoint" \
    --only-show-errors \
    --cache-control "$cache_control"
  echo "Uploaded update feed ${name} -> ${public_base}/${object_key}"
done
