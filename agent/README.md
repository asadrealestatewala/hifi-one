# Hifi One desktop agent (Windows)

A small, visible program for recording work time, application names and (if your organization's policy allows) screenshots. Read `docs/MONITORING.md` first.

Staff normally use the packaged `HifiOneAgent.exe` from **Desktop app** in Hifi One (see `docs/MONITORING.md`; build it with `node agent/build.mjs --server https://your-address`). Running from source requires Node 18 or newer.

```
node hifi-agent.mjs enroll --server https://your-hifi-one-address --code ABCDE-12345
node hifi-agent.mjs run
```

Other commands: `status`, `forget`, `selftest`. Options for `run`: `--no-screenshots`, `--simulate` (test data, no real sampling), `--once`.

Keep the window open while you work: it prints what it is doing every few seconds, and closing it stops it. It records only for a person who has accepted the monitoring policy in Hifi One, only during working hours, never during breaks.
