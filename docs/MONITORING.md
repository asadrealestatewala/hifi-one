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

## Workfolio screen sharing from the browser

The module is called **Workfolio** in the menu (Workfolio for HR and managers, My Workfolio for everyone). Besides the desktop app, a person can share their screen from the browser:

1. They clock in on My Workfolio. When the policy has screenshots on and they accepted it, a small **Workfolio pill** appears at the bottom of every screen (`src/components/shell/WorkfolioDock.tsx`).
2. They press **Share my screen**. The browser asks which screen or window to share and shows its own sharing indicator; nothing is captured unless they do this, and the browser asks again after every reload or sign-in.
3. While sharing, the pill turns red ("Workfolio is capturing your screen"), shows the countdown to the next snapshot and has **Stop sharing**. A snapshot (JPEG, at most 1600 px wide) is sent every `screenshotIntervalMin` minutes (set by an administrator in Settings > Monitoring Policy, 5 to 120).
4. The server applies the same rules as for the desktop agent (`storeScreenshot`): policy on, consent for the current version, clocked in, inside working hours, not on a break, no faster than the interval, real JPEG or PNG. Stopping the share, a break, clocking out or leaving working hours ends capture.
5. Managers see **Working now** on the Workfolio page: who is clocked in, on a break or without signal, and when each person's last snapshot was taken. They do not see a live video feed. Opening a snapshot still needs `monitoring.screenshots` and is logged for the person.

Not built: a live video view of someone's screen for managers (it would need a media relay like the meeting module; recommended only with explicit written consent), and capture of screens when the browser is closed. Real screen capture could not be exercised in the automated browser here (it blocks capture); the snapshot route, limits and consent rules are covered by tests and the dock was checked in the browser.

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
