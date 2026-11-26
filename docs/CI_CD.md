# CI/CD

This repository now uses a four-workflow CI/CD setup for `main`-based releases with draft GitHub releases, Cloudflare R2 distribution, checksum artifacts, a macOS auto-update feed, update-server sync on publish, and required signing/notarization for production macOS releases.

## Workflows

### 1) CI

File: `.github/workflows/ci.yml`

- Triggers on pull requests, pushes to `main`, and manual dispatch.
- Uses Node.js 22 + pnpm 10.
- Installs dependencies with `pnpm install --frozen-lockfile`.
- Runs:
  - `pnpm lint`
  - `pnpm test:unit`
- Pull-request only changeset gate:
  - Releasable app-code changes must include a `.changeset/*.md` file.
  - Docs/chore-only PRs are exempt.
  - Branches starting with `changeset-release/` are exempt so auto-generated release PRs are not blocked.

### 2) Changesets

File: `.github/workflows/changesets.yml`

- Triggers on pushes to `main` and manual dispatch.
- Uses `changesets/action@v1` to:
  - Create/update a Release PR (`Version Packages`) when pending changesets exist.
  - Run `pnpm ci:tag-release` after a release PR merge to create/push `vX.Y.Z` tag.
- Enables auto-merge on the `Version Packages` PR after it is created or updated.
- Uses GitHub's repository setting to auto-delete the `changeset-release/*` branch after merge.
- The PR record itself is not deleted; GitHub keeps the merged PR in history.

### 3) Release

File: `.github/workflows/release.yml`

- Triggers on tags matching `v*` and manual dispatch.
- Runs on `macos-latest` and builds `darwin arm64` distributables.
- Runs lint + unit tests before packaging.
- Builds native helper (`pnpm build:native:macos`).
- Generates release notes from `CHANGELOG.md` before packaging so Electron Forge can embed them into the macOS updater manifest.
- Builds macOS `.dmg` and `.zip` packages with Electron Forge.
- Generates `out/make/zip/darwin/arm64/RELEASES.json` for the macOS updater feed.
- Generates `out/make/SHA256SUMS` for produced macOS release artifacts.
- Uploads release files to Cloudflare R2 at:
  - `${R2_PUBLIC_BASE_URL}/${R2_RELEASE_PREFIX}/vX.Y.Z/*.dmg`
  - `${R2_PUBLIC_BASE_URL}/${R2_RELEASE_PREFIX}/vX.Y.Z/*.zip`
  - `${R2_PUBLIC_BASE_URL}/${R2_RELEASE_PREFIX}/vX.Y.Z/SHA256SUMS`
- Uploads macOS updater feed files to the **beta** feed on Cloudflare R2 (see [Beta Channel](#beta-channel)):
  - `${R2_PUBLIC_BASE_URL}/${R2_RELEASE_PREFIX}/updates/beta/darwin/arm64/*.zip`
  - `${R2_PUBLIC_BASE_URL}/${R2_RELEASE_PREFIX}/updates/beta/darwin/arm64/RELEASES.json`
- Uploads macOS release files + checksum file as GitHub Actions artifacts.
- Creates a GitHub release with:
  - `draft: true`
  - `prerelease: true`

### 4) Update Server Sync

File: `.github/workflows/update-server-sync.yml`

- Triggers on `release.prereleased` (a draft published as a pre-release: the beta channel) and `release.released` (a release published, or a pre-release turned into one: everyone).
- On `released`, first runs `scripts/promote-update-feed.sh` to move that version from the beta update feed to the release feed (macOS and Windows; Linux has no feed). For Windows it also writes `RELEASES/RELEASES` in the release feed, the address Windows builds up to 0.10.0 read, so those installs update too.
- Calls `scripts/notify-update-server.sh` with `channel` `beta` or `stable`.
- Prefers macOS `.dmg` assets for the webhook download URL and falls back to `.zip` if needed.
- Sends changelog content to the webhook using the GitHub release body, with fallback to the matching version section in `CHANGELOG.md`.
- Posts release payload to your webhook using header `x-internal-api-key: <INTERNAL_API_TOKEN>`.
- Includes retries for transient HTTP/network failures.
- Validates tag/object naming and checksum format before POSTing.
- Fails the workflow if no changelog can be resolved for the published version.
- Fails the workflow on non-2xx responses.
- Webhook target is built as `${SERVER_BASE_URL}${SERVER_RELEASE_WEBHOOK_PATH}` (default path: `/v1/app/release/webhook`).

## Update Webhook Contract

The webhook payload includes:

- `event`
- `version`
- `tag`
- `channel`
- `platform`
- `arch`
- `downloadUrl` (R2 public URL)
- `sha256`
- `releaseNotesUrl`
- `publishedAt`
- `changelog`

`channel` is `beta` when a pre-release is published and `stable` once it is promoted; a promoted version is sent again as `stable`. The website lists only `stable` builds, except `/api/builds?channel=beta`, which beta installs on Linux read.

## Beta Channel

Every release reaches the beta channel first and everyone else only once it is promoted.

- New builds upload their updater files to `updates/beta/<platform>/<arch>` only; the release feed (`updates/release/...`) is untouched until promotion.
- An install reads the beta feed when the user turned on Settings → Updates → "Get early updates", or the `beta-updates` PostHog flag is on for it (target people or a percentage in PostHog). `SCREENFORGE_UPDATE_CHANNEL=beta|stable` overrides both, for testing.
- Before letting Squirrel download, the app reads the feed itself and only updates to a newer version, so leaving the beta never installs an older build.
- **Publish to beta:** publish the draft GitHub release as it is (it is a pre-release).
- **Promote to everyone:** run `scripts/promote-release.sh X.Y.Z` with your own `gh` login, or untick "Set as a pre-release" on each platform's release. Edits made with a workflow's `GITHUB_TOKEN` don't start workflows, so promotion has to come from a person (or a PAT).
- **Skip the beta:** untick "Set as a pre-release" before publishing the draft.
- Use normal version numbers (`0.12.0`), not `0.12.0-beta.1`: the same build is promoted unchanged, and the app's version check ignores pre-release suffixes.

## Signing And Notarization (Required)

Release workflow requires all Apple signing/notarization secrets before packaging.

- Imports signing certificate into a temporary keychain.
- Writes App Store Connect API key to a temp file.
- Enables Forge signing/notarization through environment variables.
- Fails the release workflow immediately if required Apple secrets are incomplete.

## Required Secrets

### Required now

- `SERVER_BASE_URL`
- `INTERNAL_API_TOKEN`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `R2_PUBLIC_BASE_URL`

### Reserved for signing/notarization

- `APPLE_CERTIFICATE_P12_BASE64`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_TEAM_ID`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER_ID`
- `APPLE_API_PRIVATE_KEY`

## Optional Repository Variables

- `R2_RELEASE_PREFIX` (default: `screenforge`)
- `SERVER_RELEASE_WEBHOOK_PATH` (default: `/v1/app/release/webhook`)

## Branch Protection (GitHub Settings)

Branch protection must be configured in repository settings (cannot be fully enforced from workflow files alone).

Recommended `main` rules:

- Require pull request before merge.
- Require status checks to pass before merge.
- Required checks:
  - `CI / validate`
- Enable repository setting `Allow auto-merge`.
- Enable repository setting `Automatically delete head branches`.
- Restrict direct pushes to `main` for non-admin users.
- If `main` requires approving reviews, the `Version Packages` PR also needs that approval before auto-merge can complete.

## Security Notes

- Checkout steps in non-publishing workflows disable persisted Git credentials.
- Update-server sync uses sparse checkout to fetch only the webhook script and `CHANGELOG.md`.
- R2 upload/webhook scripts validate path components, enforce HTTPS public URLs, and verify SHA256 checksum format.
- Third-party GitHub Actions are pinned to immutable commit SHAs to reduce supply-chain risk.
- Release and update-sync jobs run in GitHub Environment `production` (configure required reviewers for secret access control).
- Keep R2 credentials scoped to a single bucket/prefix with least-privilege permissions.

## Suggested Release Flow

1. Open feature PRs against `main` with changeset files when app behavior is releasable.
2. Merge PRs to `main`.
3. Let the Changesets workflow open/update the `Version Packages` PR and enable auto-merge.
4. Let CI checks on that PR pass so GitHub can merge it automatically.
5. Let GitHub auto-delete the `changeset-release/*` branch after merge if that repository setting is enabled.
6. Let CI create and push `vX.Y.Z` tag.
7. Let the release workflows build artifacts, publish versioned downloads and the beta updater feeds to R2, and create draft pre-release GitHub releases.
8. Validate artifacts and publish the GitHub releases: beta installs get the version.
9. Once it looks good on beta, run `scripts/promote-release.sh X.Y.Z`: Update Server Sync moves it to the release feed and the website lists it for everyone.
