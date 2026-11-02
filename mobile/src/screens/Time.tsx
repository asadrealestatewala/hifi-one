import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { api, type Attendance } from "../api";
import { Button, Card, Empty, ErrorText, Loading, Muted, fmtDate, fmtMinutes, fmtTime } from "../ui";
import { useLoad } from "../useLoad";

export default function Time() {
  const { data, setData, error, refreshing, reload } = useLoad<Attendance>("attendance");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  async function act(action: string, mode?: "OFFICE" | "REMOTE") {
    setBusy(action + (mode ?? "")); setMsg("");
    try { setData(await api<Attendance>("attendance", { method: "POST", body: { action, mode } })); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Could not save."); }
    setBusy("");
  }
  if (!data) return error ? <View style={{ padding: 16 }}><ErrorText>{error}</ErrorText></View> : <Loading />;
  const o = data.open;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} />}>
      <Muted>Attendance is the time between clock in and clock out, minus breaks.</Muted>
      <ErrorText>{msg}</ErrorText>
      <Card>
        {o ? (
          <>
            <Text style={{ fontWeight: "700" }}>Clocked in at {fmtTime(o.since)} ({o.mode.toLowerCase()}){o.onBreak ? " · on break" : ""}</Text>
            <Muted>Worked so far: {fmtMinutes(o.workedMinutes)}</Muted>
            <Button title={o.onBreak ? "End break" : "Start break"} kind="ghost" busy={busy.startsWith("break")} onPress={() => act(o.onBreak ? "break_end" : "break_start")} />
            <Button title="Clock out" busy={busy === "out"} onPress={() => act("out")} />
          </>
        ) : (
          <>
            <Text style={{ fontWeight: "700" }}>You are not clocked in</Text>
            <Button title="Clock in (office)" busy={busy === "inOFFICE"} onPress={() => act("in", "OFFICE")} />
            <Button title="Clock in (remote)" kind="ghost" busy={busy === "inREMOTE"} onPress={() => act("in", "REMOTE")} />
          </>
        )}
      </Card>
      <Text style={{ fontWeight: "700", marginTop: 6 }}>Last 14 days</Text>
      {data.recent.length === 0 ? <Empty title="No records yet" /> : data.recent.map((r) => (
        <Card key={r.id}>
          <Text style={{ fontWeight: "600" }}>{fmtDate(r.date)} · {fmtMinutes(r.workedMinutes)}</Text>
          <Muted>{fmtTime(r.clockIn)} to {r.clockOut ? fmtTime(r.clockOut) : "still open"} · {r.mode.toLowerCase()}</Muted>
        </Card>
      ))}
    </ScrollView>
  );
}
