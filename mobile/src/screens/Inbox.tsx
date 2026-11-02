import { RefreshControl, ScrollView, Text, View } from "react-native";
import { api, type Notice } from "../api";
import { Button, Card, Empty, ErrorText, Loading, Muted, fmtDate } from "../ui";
import { useLoad } from "../useLoad";

export default function Inbox() {
  const { data, error, refreshing, reload } = useLoad<{ unread: number; notifications: Notice[] }>("notifications");
  if (!data) return error ? <View style={{ padding: 16 }}><ErrorText>{error}</ErrorText></View> : <Loading />;
  const markAll = async () => { await api("notifications", { method: "POST", body: { all: true } }).catch(() => {}); reload(); };
  const markOne = async (id: string) => { await api("notifications", { method: "POST", body: { id } }).catch(() => {}); reload(); };
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} />}>
      {data.unread ? <Button title={`Mark all ${data.unread} as read`} kind="ghost" onPress={markAll} /> : null}
      {data.notifications.length === 0 ? <Empty title="No notifications" hint="Task assignments, approvals and leave decisions appear here." /> : data.notifications.map((n) => (
        <Card key={n.id} style={n.read ? { opacity: 0.65 } : undefined}>
          <Text style={{ fontWeight: n.read ? "500" : "700" }}>{n.title}</Text>
          {n.body ? <Muted>{n.body}</Muted> : null}
          <Muted>{fmtDate(n.createdAt)}</Muted>
          {!n.read ? <Button title="Mark read" kind="ghost" onPress={() => markOne(n.id)} /> : null}
        </Card>
      ))}
    </ScrollView>
  );
}
