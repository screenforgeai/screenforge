# Contributing to Screenforge

Thanks for considering a contribution. This repository is the
Screenforge desktop app (Electron + React).

## Getting set up

**Prerequisites:** Node.js 22.12+, pnpm 10 (pnpm 11 ignores this repo's
`.npmrc` settings, which Electron Forge needs)

```bash
git clone https://github.com/screenforgeai/screenforge.git
cd screenforge
pnpm install
pnpm download:ffmpeg:linux    # Linux only — Windows: pnpm download:ffmpeg:windows
cp .env.example .env   # optional — only needed for signing/telemetry locally; never commit it
pnpm start
```

macOS uses the FFmpeg build committed in `native/bin/ffmpeg/darwin-arm64/`;
Linux and Windows binaries are too large to commit, so they're downloaded.

## Before opening a PR

```bash
pnpm lint         # ESLint
pnpm format       # Prettier write
pnpm test:unit    # Vitest unit tests
pnpm test:export  # Export pipeline tests
```

All four should pass. CI runs `pnpm lint` and `pnpm test:unit` on every
PR, plus a secret scan that fails if a commit contains a credential.

Release, signing and upload workflows only run in the upstream
`screenforgeai` repository — they're skipped in forks, and your fork's
builds ship with telemetry and auto-update turned off.

## Changesets

Releasable app-code changes need a changeset:

```bash
pnpm changeset
```

Pick the appropriate bump (patch/minor/major) and describe the user-facing
change — this becomes the CHANGELOG entry. Docs-only or chore-only PRs
are exempt (CI checks for this automatically).

## Code conventions

The short version — see [`CLAUDE.md`](./CLAUDE.md) for the full architecture
writeup:

- Arrow function components only (`const Foo = () => ...`)
- IPC channels are declared in `electron/channels.ts`, main-process
  modules follow the `channel.ts` / `service.ts` / `bridge.ts` pattern
- Any user-visible, undoable state change goes through `commitEdit()` in
  the Zustand store
- Tailwind v4 with `sf-*` color tokens — no new hardcoded colors
- Icons go through `createIcon()` in `src/lib/icons.tsx`

## Reporting bugs / requesting features

Open a GitHub issue. For security vulnerabilities, see
[`SECURITY.md`](./SECURITY.md) instead — please don't file those
publicly.

## License

By contributing, you agree that your contributions will be licensed
under the project's [AGPL-3.0-or-later](./LICENSE) license.
