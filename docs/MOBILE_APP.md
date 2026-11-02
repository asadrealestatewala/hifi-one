# Mobile app (Android first, iOS-ready)

Expo / React Native app in `mobile/`. It talks to the ERP through a small bearer-token JSON API at `/api/mobile/v1/*`
(`src/app/api/mobile/v1`, helpers in `src/lib/mobile-api.ts`). The website's cookie-and-server-action pages are untouched.

## What it does (v0.1, staff only)
Sign in (email or phone + password, then authenticator code when on), Home (task counts, clock state, unread), My tasks (open/done, move status with `tasks.edit`),
Attendance (clock in/out, breaks, last 14 days), Leave (balances, request, cancel), Inbox (notifications, mark read).
Clients and vendors are refused with a pointer to the web portal. Accounts that must change their password or set up two-step verification are told to do that on the website first.

## API
`POST login`, `POST mfa`, `POST logout`, `GET me`, `GET tasks`, `PATCH tasks/:id`, `GET|POST attendance`, `GET|POST leave`, `GET|POST notifications`, `POST|DELETE devices`.
- Sign-in uses `checkCredentials` in `src/lib/auth.ts`, the same code the website uses: normalised email/phone, per-IP and per-identifier limits, lockout after 5 failures, onboarding gate, audit entries.
- The token is the ordinary signed session token (12 hours, database session). Sign-out revokes it; deactivating a person ends it. The app keeps it in the phone's secure storage.
- Every route except `login` and `mfa` calls `requireMobileUser` (staff only, plus a named permission where the web page needs one). `src/lib/guards.test.ts` enforces this.
- Business rules are the existing services (`clockIn`, `requestLeave`, `changeTaskStatus` ...); mobile actions are audited with `via: "mobile"` where the audit has a payload.

## Run it
```
cd mobile && npm install
EXPO_PUBLIC_API_URL=https://hifimarketing.co npx expo start      # scan the QR code with Expo Go on the phone
```
Server side: nothing to configure beyond the existing `SESSION_SECRET`; deploy this branch as usual.

## Push notifications
Every in-app notification (`notify()` in `src/lib/notifications.ts`) also goes to the person's signed-in phones through Expo's push service (`src/lib/push.ts`, table `PushDevice`). Best effort: a failed push never blocks the action. Tapping one opens the Inbox.
Setup the owner must do once: `cd mobile && npx eas-cli init` (writes the project id into `app.json`), create a free Firebase project, add an Android app with package `co.hifimarketing.hifione`, save its `google-services.json` in `mobile/` (it is git-ignored), then upload the FCM service-account key to EAS (`eas credentials`). Until then the app works but receives no pushes. `PUSH_DISABLED=1` switches sending off on the server. Push does not work in Expo Go on Android; use the preview APK.

## Ship it (needs the owner's accounts)
1. Expo account, then `npx eas-cli login` and `eas build -p android --profile preview` for an installable APK (internal testing), or `--profile production` for a Play Store bundle.
2. Google Play Console developer account (one-time fee) to publish; signing keys are created and held by EAS. iOS needs an Apple Developer account (yearly fee) and a Mac is not required with EAS.
3. Replace the icon and splash in `mobile/assets` with the Hifi One brand.

## Not built yet
Client and vendor portals in the app, expenses, payslips, offline mode, biometric unlock, password change / forgot password in the app.
Not verified on a device or emulator: the app type-checks (`cd mobile && npx tsc --noEmit`) and the server checks pass, but it has not been run on a phone.

## Distribution

Staff get the app with one click: **Account menu (bottom of the sidebar) > Get the Android app**, or the button on the public page `/site/app`. Both go to `/api/app/android`, which redirects to `ANDROID_APK_URL` (https) or the file `public/downloads/hifi-one.apk` on the server (git-ignored; upload it with scp and keep it across deploys), and answers 404 "not published yet" when neither exists. The current build is debug-signed and push is not enabled.
