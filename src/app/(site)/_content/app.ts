// The staff mobile app download. Update APK_URL and APK_VERSION when a new build is published (see docs/MOBILE_APP.md).
export const APK_URL: string | null = null; // e.g. "https://github.com/asadrealestatewala/hifi-one/releases/download/mobile-v0.1.0/hifi-one.apk"
export const APK_VERSION = "0.1.0";
export const APP_FEATURES = [
  "Sign in with your work email or phone, plus two-step code when it is on",
  "See and update your tasks",
  "Clock in, take breaks and clock out",
  "Request leave and see your balances",
  "Get alerts and read your inbox",
] as const;
