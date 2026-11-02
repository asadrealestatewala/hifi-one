import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

let registered: string | null = null;

// Asks permission, gets this phone's Expo push token and tells the server. Never throws: push is a convenience, the Inbox always works.
// Needs an EAS project id (set by `eas init`) and, for Android builds, Firebase credentials uploaded to EAS.
export async function registerForPush(): Promise<void> {
  try {
    if (!Device.isDevice) return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return;
    if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("default", { name: "Hifi One", importance: Notifications.AndroidImportance.HIGH });
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== "granted") return;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await api("devices", { method: "POST", body: { token, platform: Platform.OS === "ios" ? "ios" : "android" } });
    registered = token;
  } catch {
    // push unavailable on this build; ignore
  }
}

// Called before sign-out so the phone stops receiving this person's alerts.
export async function unregisterPush(): Promise<void> {
  if (!registered) return;
  await api("devices", { method: "DELETE", body: { token: registered } }).catch(() => {});
  registered = null;
}

export function onNotificationTap(open: () => void) {
  const sub = Notifications.addNotificationResponseReceivedListener(open);
  return () => sub.remove();
}
