import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { Pressable, SafeAreaView, Text, View } from "react-native";
import { api, clearToken, loadToken, setSignedOutHandler, type Me } from "./api";
import Home from "./screens/Home";
import Inbox from "./screens/Inbox";
import Leave from "./screens/Leave";
import Login from "./screens/Login";
import Tasks from "./screens/Tasks";
import Time from "./screens/Time";
import { onNotificationTap, registerForPush, unregisterPush } from "./push";
import { C, Loading } from "./ui";

type Tab = "home" | "tasks" | "time" | "leave" | "inbox";

export default function App() {
  const [state, setState] = useState<"boot" | "out" | "in">("boot");
  const [me, setMe] = useState<Me["user"] | null>(null);
  const [tab, setTab] = useState<Tab>("home");

  const enter = useCallback(async () => {
    try { const r = await api<Me>("me"); setMe(r.user); setState("in"); registerForPush(); }
    catch { setState("out"); }
  }, []);

  useEffect(() => {
    setSignedOutHandler(() => setState("out"));
    loadToken().then((t) => (t ? enter() : setState("out")));
  }, [enter]);

  useEffect(() => onNotificationTap(() => setTab("inbox")), []);

  const signOut = async () => { await unregisterPush(); await api("logout", { method: "POST" }).catch(() => {}); await clearToken(); setState("out"); setTab("home"); };

  if (state === "boot") return <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}><Loading /></SafeAreaView>;
  if (state === "out") return <><StatusBar style="light" /><Login onDone={enter} /></>;

  const tabs: [Tab, string][] = [["home", "Home"], ["tasks", "Tasks"], ...(me?.can.attendance ? [["time", "Time"] as [Tab, string]] : []), ...(me?.can.leave ? [["leave", "Leave"] as [Tab, string]] : []), ["inbox", "Inbox"]];
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar style="dark" />
      <View style={{ flex: 1 }}>
        {tab === "home" && <Home go={(t) => setTab(t)} onSignOut={signOut} />}
        {tab === "tasks" && <Tasks canEdit={!!me?.can.editTasks} />}
        {tab === "time" && <Time />}
        {tab === "leave" && <Leave />}
        {tab === "inbox" && <Inbox />}
      </View>
      <View accessibilityRole="tablist" style={{ flexDirection: "row", borderTopWidth: 1, borderColor: C.border, backgroundColor: C.surface }}>
        {tabs.map(([k, label]) => (
          <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} onPress={() => setTab(k)} style={{ flex: 1, alignItems: "center", paddingVertical: 14 }}>
            <Text style={{ fontSize: 13, fontWeight: tab === k ? "700" : "500", color: tab === k ? C.primary : C.muted }}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}
