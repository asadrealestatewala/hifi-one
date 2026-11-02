import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { api, type Task } from "../api";
import { C, Card, Empty, ErrorText, Loading, Muted, fmtDate } from "../ui";
import { useLoad } from "../useLoad";

const STATUSES: [string, string][] = [["TODO", "To do"], ["IN_PROGRESS", "In progress"], ["REVIEW", "Review"], ["DONE", "Done"]];
type Res = { tasks: Task[]; total: number; page: number; pages: number };

export default function Tasks({ canEdit }: { canEdit: boolean }) {
  const [show, setShow] = useState<"open" | "done">("open");
  const { data, setData, error, refreshing, reload } = useLoad<Res>(`tasks?show=${show}`);
  const [msg, setMsg] = useState("");
  const today = new Date().toISOString().slice(0, 10);

  async function move(t: Task, status: string) {
    if (status === t.status) return;
    setMsg("");
    try {
      await api(`tasks/${t.id}`, { method: "PATCH", body: { status } });
      reload();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not update the task."); }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} />}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {(["open", "done"] as const).map((k) => (
          <Pressable key={k} onPress={() => { setData(null); setShow(k); }} style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: 99, backgroundColor: show === k ? C.primary : C.hover }}>
            <Text style={{ color: show === k ? "#fff" : C.fg, fontWeight: "600" }}>{k === "open" ? "Open" : "Done"}</Text>
          </Pressable>
        ))}
      </View>
      <ErrorText>{error || msg}</ErrorText>
      {!data ? <Loading /> : data.tasks.length === 0 ? <Empty title={show === "done" ? "Nothing finished yet" : "No tasks assigned to you"} hint="Tasks a project manager assigns to you appear here." /> : data.tasks.map((t) => {
        const late = t.status !== "DONE" && t.dueDate && t.dueDate.slice(0, 10) < today;
        return (
          <Card key={t.id}>
            <Text style={{ fontWeight: "700", color: C.fg }}>{t.title}</Text>
            <Muted>{t.project.number ? `${t.project.number} · ` : ""}{t.project.name} · {t.priority.toLowerCase()}</Muted>
            {t.dueDate ? <Text style={{ fontSize: 13, color: late ? C.danger : C.muted }}>{late ? "Overdue · " : "Due "}{fmtDate(t.dueDate)}</Text> : null}
            {t.blocked ? <Text style={{ fontSize: 13, color: C.danger }}>Blocked</Text> : null}
            {canEdit ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                {STATUSES.map(([k, label]) => (
                  <Pressable key={k} accessibilityRole="button" accessibilityLabel={`Mark ${t.title} as ${label}`} onPress={() => move(t, k)}
                    style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: t.status === k ? C.primary : C.border, backgroundColor: t.status === k ? C.primary : C.surface }}>
                    <Text style={{ fontSize: 12, color: t.status === k ? "#fff" : C.fg }}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : <Muted>{STATUSES.find(([k]) => k === t.status)?.[1] ?? t.status}</Muted>}
          </Card>
        );
      })}
      {data && data.pages > 1 ? <Muted>Showing the first 25 of {data.total}. Use the website for the full list.</Muted> : null}
    </ScrollView>
  );
}

