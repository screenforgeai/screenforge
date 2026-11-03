# Security Policy

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report it privately instead, either way works:

- **GitHub:** the repository's **Security** tab → **Report a vulnerability**
  (private vulnerability reporting)
- **Email:** **security@screenforge.co**

Include:

- A description of the vulnerability and its potential impact
- Steps to reproduce (proof-of-concept code/commands if possible)
- The affected version (`package.json` version, and OS/platform)

You should get an acknowledgement within a few days. Once a fix is ready,
we'll credit you in the release notes unless you'd prefer to stay
anonymous.

## Scope

This covers the Screenforge desktop app — the Electron app itself, its
IPC surface, FFmpeg invocation, project file parsing, and the
auto-updater. Third-party dependencies should generally be reported
upstream, but flag it here too if it's exploitable specifically through
Screenforge.

## Leaked credentials

No credentials belong in this repository. Signing keys, telemetry keys
and release-upload tokens live only in the upstream repository's GitHub
Actions secrets. If you spot one in the code or history, report it
privately as above so it can be revoked.
