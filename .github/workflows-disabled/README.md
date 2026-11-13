# Switched off GitHub Actions workflows

GitHub Actions is blocked on this account by billing, so these workflows were moved out of `.github/workflows/`
(GitHub only runs files in that folder). Nothing here runs.

- `deploy.yml` is replaced by `deploy/auto-deploy.sh`, run by cron on the VPS (see docs/DEPLOYMENT.md, "Automatic deploys").
- `ci.yml` (types, lint, tests) and `android-apk.yml` (APK build) need Actions. Run the checks locally with the commands in CLAUDE.md.

To switch one back on, move it back into `.github/workflows/`.
