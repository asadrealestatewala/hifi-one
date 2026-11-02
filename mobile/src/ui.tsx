import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import type { ReactNode } from "react";

export const C = { bg: "#f6f7fb", fg: "#161a33", surface: "#ffffff", border: "#e5e7f0", muted: "#6b7189", primary: "#5648e8", navy: "#12163a", danger: "#c0392b", hover: "#f0f1f8" };

export function Button({ title, onPress, busy, kind = "primary", disabled }: { title: string; onPress: () => void; busy?: boolean; kind?: "primary" | "ghost"; disabled?: boolean }) {
  const ghost = kind === "ghost";
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={busy || disabled} style={({ pressed }) => [s.btn, ghost && s.btnGhost, (pressed || busy || disabled) && { opacity: 0.6 }]}>
      {busy ? <ActivityIndicator color={ghost ? C.primary : "#fff"} /> : <Text style={[s.btnText, ghost && { color: C.primary }]}>{title}</Text>}
    </Pressable>
  );
}
export const Card = ({ children, style }: { children: ReactNode; style?: ViewStyle }) => <View style={[s.card, style]}>{children}</View>;
export const H = ({ children }: { children: ReactNode }) => <Text style={s.h}>{children}</Text>;
export const Muted = ({ children }: { children: ReactNode }) => <Text style={{ color: C.muted, fontSize: 13 }}>{children}</Text>;
export const ErrorText = ({ children }: { children?: string }) => (children ? <Text accessibilityRole="alert" style={{ color: C.danger, fontSize: 13 }}>{children}</Text> : null);
export const Empty = ({ title, hint }: { title: string; hint?: string }) => (
  <Card><Text style={{ fontWeight: "600", color: C.fg }}>{title}</Text>{hint ? <Muted>{hint}</Muted> : null}</Card>
);
export const Loading = () => <ActivityIndicator style={{ marginTop: 40 }} color={C.primary} />;

export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export const fmtMinutes = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });

const s = StyleSheet.create({
  btn: { backgroundColor: C.primary, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 18, alignItems: "center", minHeight: 46, justifyContent: "center" },
  btnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: C.primary },
  btnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  card: { backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, gap: 8 },
  h: { fontSize: 20, fontWeight: "700", color: C.fg },
});
