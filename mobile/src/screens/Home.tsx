import { RefreshControl, ScrollView, Text, View } from "react-native";
import type { Me } from "../api";
import { Button, Card, ErrorText, H, Loading, Muted, fmtTime } from "../ui";
import { useLoad } from "../useLoad";

export default function Home({ go, onSignOut }: { go: (tab: "tasks" | "time" | "leave" | "inbox") => void; onSignOut: () => void }) {
  const { data, error, refreshing, reload } = useLoad<Me>("me");
  if (!data) return error ? <View style={{ padding: 16, gap: 10 }}><ErrorText>{error}</ErrorText><Button title="Try again" onPress={reload} /></View> : <Loading />;
  const stat = (label: string, value: number, warn?: boolean) => (
    <Card style={{ flex: 1 }}><Text style={{ fontSize: 24, fontWeight: "800", color: warn && value ? "#c0392b" : "#161a33" }}>{value}</Text><Muted>{label}</Muted></Card>
  );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} />}>
      <H>Hello, {data.user.name.split(" ")[0]}</H>
      <Muted>{data.user.roles.join(", ") || "Staff"} · {data.today}</Muted>
      <View style={{ flexDirection: "row", gap: 10 }}>{stat("Open tasks", data.tasks.open)}{stat("Due today", data.tasks.dueToday)}{stat("Overdue", data.tasks.overdue, true)}</View>
      {data.user.can.attendance && (
        <Card>
          <Text style={{ fontWeight: "700" }}>Attendance</Text>
          <Muted>{data.clockedIn ? `Clocked in at ${fmtTime(data.clockedIn.since)} (${data.clockedIn.mode.toLowerCase()})${data.clockedIn.onBreak ? " · on break" : ""}` : "You are not clocked in."}</Muted>
          <Button title={data.clockedIn ? "Open attendance" : "Clock in"} onPress={() => go("time")} />
        </Card>
      )}
      <Card>
        <Text style={{ fontWeight: "700" }}>Inbox</Text>
        <Muted>{data.notifications.unread ? `${data.notifications.unread} unread` : "Nothing unread."}</Muted>
        {data.user.can.leave && data.pendingLeave ? <Muted>{data.pendingLeave} leave request(s) waiting for approval.</Muted> : null}
        <Button title="Open inbox" kind="ghost" onPress={() => go("inbox")} />
      </Card>
      <Button title="Sign out" kind="ghost" onPress={onSignOut} />
    </ScrollView>
  );
}
