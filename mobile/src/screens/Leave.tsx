import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { api, type Leave } from "../api";
import { Button, C, Card, Empty, ErrorText, Loading, Muted } from "../ui";
import { useLoad } from "../useLoad";

export default function LeaveScreen() {
  const { data, setData, error, refreshing, reload } = useLoad<Leave>("leave");
  const [typeId, setTypeId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function post(body: object, after?: () => void) {
    setBusy(true); setMsg("");
    try { setData(await api<Leave>("leave", { method: "POST", body })); after?.(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Could not save."); }
    setBusy(false);
  }
  if (!data) return error ? <View style={{ padding: 16 }}><ErrorText>{error}</ErrorText></View> : <Loading />;
  const chosen = typeId || data.types[0]?.id || "";
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} />} keyboardShouldPersistTaps="handled">
      <Text style={{ fontWeight: "700" }}>Balances {data.year}</Text>
      {data.balances.map((b) => <Card key={b.type}><Text style={{ fontWeight: "600" }}>{b.type}</Text><Muted>{b.available} of {b.allowance} days available · {b.approved} used · {b.pending} pending</Muted></Card>)}
      <Text style={{ fontWeight: "700", marginTop: 6 }}>Request leave</Text>
      <Card>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {data.types.map((t) => (
            <Pressable key={t.id} onPress={() => setTypeId(t.id)} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: chosen === t.id ? C.primary : C.border, backgroundColor: chosen === t.id ? C.primary : C.surface }}>
              <Text style={{ fontSize: 12, color: chosen === t.id ? "#fff" : C.fg }}>{t.name}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={lbl}>From (YYYY-MM-DD)</Text>
        <TextInput value={start} onChangeText={setStart} placeholder="2026-12-01" autoCapitalize="none" style={input} />
        <Text style={lbl}>To (YYYY-MM-DD)</Text>
        <TextInput value={end} onChangeText={setEnd} placeholder="2026-12-03" autoCapitalize="none" style={input} />
        <Text style={lbl}>Reason (optional)</Text>
        <TextInput value={reason} onChangeText={setReason} style={input} />
        <ErrorText>{msg}</ErrorText>
        <Button title="Send request" busy={busy} disabled={!chosen || !start || !end} onPress={() => post({ leaveTypeId: chosen, startDate: start, endDate: end, reason }, () => { setStart(""); setEnd(""); setReason(""); })} />
      </Card>
      <Text style={{ fontWeight: "700", marginTop: 6 }}>My requests</Text>
      {data.requests.length === 0 ? <Empty title="No leave requests yet" /> : data.requests.map((r) => (
        <Card key={r.id}>
          <Text style={{ fontWeight: "600" }}>{r.type} · {r.startDate} to {r.endDate} ({r.days} d)</Text>
          <Muted>{r.status.toLowerCase()}{r.decisionNote ? ` · ${r.decisionNote}` : ""}</Muted>
          {r.status === "PENDING" || r.status === "APPROVED" ? <Button title="Cancel request" kind="ghost" busy={busy} onPress={() => post({ cancelId: r.id })} /> : null}
        </Card>
      ))}
    </ScrollView>
  );
}
const lbl = { fontSize: 13, fontWeight: "600" as const, color: C.fg };
const input = { borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 10, fontSize: 15, color: C.fg, backgroundColor: C.bg };
