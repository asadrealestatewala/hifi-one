# Hifi One work sites (browser add-on)

Reports the **website name** you spend work time on (for example `github.com`) to Hifi One, so it can show you and HR time per site.

Load it: Chrome or Edge → Extensions → Developer mode → Load unpacked → choose this folder. Open the add-on, enter your Hifi One address, press Save and allow access.

Rules it follows (enforced again on the server in `src/lib/monitoring.ts`):

- Reports only while you are clocked in, have accepted the terms, the policy includes websites, it is working hours and you are not on a break. Otherwise it records nothing and tells you why.
- Sends only a host name and seconds. Never the page, path, query, title or tab content. Private windows are never read. No history is collected.
- Uses your own Hifi One sign-in; it has no separate password or token. Sign out and it stops.
- Switch it off at any time by removing the add-on.

Not yet packaged for the Chrome Web Store; for company computers, install it by policy or as an unpacked folder.
