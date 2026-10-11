# Work time and activity monitoring

Hifi One includes a transparent time-tracking and activity module in the spirit of tools such as Workfolio. It is built around consent, minimal collection and visibility to the person being measured. This page says exactly what it does and does not do.

## What is collected

| Item | Browser tracker | Desktop app |
|---|---|---|
| Clock in and out, breaks | Yes | Yes |
| Seconds active and idle | In the Hifi One tab only | Whole computer (time since last input) |
| Key presses and clicks | Counted in the Hifi One tab | **Not collected** (would need a system-wide keyboard hook) |
| Application names | No (a browser cannot see other apps) | Optional, names only, durations |
| Screenshots | No | Optional, at the policy interval |

**Never collected, by design:** what is typed, passwords, messages, window titles, web addresses, pointer positions, microphone or camera. The database has no column that could hold them.

## The rules the system enforces (not just documents)

1. **Off by default.** Nothing is recorded until an administrator writes the policy text and turns monitoring on.
2. **Consent per person and per version.** Each employee must read and accept the current policy. Any change to what is collected raises the version and everyone must accept again. People who have not accepted are not recorded at all, by the web tracker or the desktop app.
3. **Working hours only, never on breaks.** The policy sets a time zone, hours and days. Heartbeats and uploads outside them, or during a break, are discarded.
4. **Honest figures.** A browser cannot claim more active seconds than have passed; the server trims impossible numbers. The desktop agent's uploads are checked the same way.
5. **Screenshots** are accepted only when the policy has them on, inside working hours, outside breaks, no faster than the interval, and only real PNG/JPEG images.
6. **Visibility.** My Time & Activity shows the employee everything recorded about them, including their screenshots, the applications seen, and a list of who has opened their screenshots or detailed reports.
7. **Access is limited and logged.** Team reports need `monitoring.view_team`; opening anyone else's screenshot needs `monitoring.screenshots` (given to HR Manager only by default). A manager is **not** automatically allowed to see them. Every such view is written to the access log the employee can read.
8. **Dispute and correction.** Employees can flag a screenshot (HR sees it in a "flagged" view) and request a corrected timesheet day. Nobody can decide their own request.
9. **Retention.** Screenshots are deleted after the policy's retention period; activity totals after 180 days. Run `npm run monitoring:purge` daily from a scheduler. HR can also delete a screenshot immediately.
10. **Reports are context, not a verdict.** The report page says so, and it deliberately has no "productivity score".

## Roles and permissions

| Permission | Who by default | What it allows |
|---|---|---|
| `monitoring.own` | every staff role | use the tracker, see all of one's own data |
| `monitoring.view_team` | HR Manager | workforce report, correction approvals |
| `monitoring.screenshots` | HR Manager | open other people's screenshots (logged) |
| `monitoring.configure` | HR Manager | policy, devices, enrolment codes, retention |

Super Admin holds all of them. Project managers see project time through the project page, not through this module.

## The desktop app

`agent/hifi-agent.mjs` (Windows, Node 18+). It is a visible console program: it prints what it is doing on every cycle and closing the window stops it.

1. HR opens **Settings → Monitoring Policy**, chooses the person and creates a one-time enrolment code (valid one hour, single use).
2. On the person's computer: `node hifi-agent.mjs enroll --server https://your-address --code ABCDE-12345`. It prints what the policy collects.
3. `node hifi-agent.mjs run` starts recording (only if the person has accepted the policy in Hifi One).
4. `status` shows what the policy currently allows; `forget` removes the saved sign-in; `selftest` checks the sampler and screen capture locally and sends nothing.
5. HR can **revoke** a device at any time; it stops working immediately. Deactivating the person does the same.

What is verified so far: enrolment, policy retrieval, activity and application uploads, server-side rejection of out-of-policy data, and screenshot storage were exercised end to end against a running server using the agent's simulation mode. The Windows sampler and screen capture were checked locally with `selftest`. **Not yet done:** packaging the agent as a signed installer or Windows service, automatic start at login, offline buffering, and macOS or Linux versions. A signed installer is the right next step before rolling out widely.

## Before you turn it on

- Write the policy text with HR and legal advice for every country where staff work (Pakistan, the UAE, the UK and the US differ). The starter text in the settings page is a draft, not legal advice.
- Tell staff in advance, in writing, and hold the first week as a trial with the figures visible only to the employees themselves.
- Decide who will hold `monitoring.screenshots` and review the access log monthly.
- Remember that remote workers' home computers may hold personal material; keep screenshots off unless you have a clear need, and keep the retention short.
