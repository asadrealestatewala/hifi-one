import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { RTCPeerConnection, mediaDevices, type MediaStream } from "react-native-webrtc";
import { api } from "../api";
import { C } from "../ui";

// Remote support on a company phone. Everything here is visible and asks first:
//  1. Terms: shown with a tick-box; nothing happens until the person accepts them.
//  2. A request names who wants to help and why. The person chooses Allow or No thanks every time.
//  3. Allow opens Android's own screen-sharing prompt and recording indicator; the helper sees only what that prompt shares.
//  4. A red banner stays on screen with Stop for as long as the session runs.
type State = {
  enabled: boolean; needsTerms: boolean; terms: { version: number; text: string } | null;
  request: { id: string; status: string; helper: string; reason: string | null; expiresInSeconds: number | null } | null;
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
};

export default function SupportGate() {
  const [st, setSt] = useState<State | null>(null);
  const [ticked, setTicked] = useState(false);
  const [live, setLive] = useState<{ id: string; helper: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const stopSignals = useRef<(() => void) | null>(null);

  const refresh = useCallback(async () => { try { setSt(await api<State>("support")); } catch { /* offline: keep what is shown */ } }, []);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => { if (AppState.currentState === "active" && !pc.current) void refresh(); }, 8000);
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") void refresh(); });
    return () => { clearInterval(t); sub.remove(); };
  }, [refresh]);

  const teardown = useCallback(() => {
    stopSignals.current?.(); stopSignals.current = null;
    pc.current?.close(); pc.current = null;
    stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null;
    setLive(null);
  }, []);
  useEffect(() => teardown, [teardown]);

  async function stop(id: string) { await api("support", { method: "POST", body: { op: "end", id } }).catch(() => undefined); teardown(); void refresh(); }

  async function allow(req: NonNullable<State["request"]>, ice: State["iceServers"]) {
    setErr(null);
    let s: MediaStream;
    try { s = (await mediaDevices.getDisplayMedia({ video: true } as never)) as MediaStream; } // Android shows its own "start recording or casting" prompt
    catch { await api("support", { method: "POST", body: { op: "respond", id: req.id, accept: false } }).catch(() => undefined); setErr("Screen sharing was not allowed, so nothing was shared."); void refresh(); return; }
    stream.current = s;
    const conn = new RTCPeerConnection({ iceServers: ice });
    pc.current = conn;
    s.getVideoTracks().forEach((t) => { conn.addTrack(t, s); t.addEventListener?.("ended", () => void stop(req.id)); });
    const send = (data: unknown) => api("support", { method: "POST", body: { op: "signal", id: req.id, data } }).catch(() => undefined);
    (conn as unknown as { onicecandidate: (e: { candidate: { toJSON(): unknown } | null }) => void }).onicecandidate = (e) => { if (e.candidate) void send({ candidate: e.candidate.toJSON() }); };
    (conn as unknown as { onconnectionstatechange: () => void }).onconnectionstatechange = () => { if (["failed", "closed"].includes(String(conn.connectionState))) void stop(req.id); };
    setLive({ id: req.id, helper: req.helper });
    await api("support", { method: "POST", body: { op: "respond", id: req.id, accept: true } });
    // The helper's handshake messages wait on the server; read them every second.
    let after = 0; let on = true;
    stopSignals.current = () => { on = false; };
    while (on) {
      try {
        const r = await api<{ status: string; signals: { seq: number; data: { sdp?: { type: string; sdp: string }; candidate?: unknown } }[] }>(`support?signals=${req.id}&after=${after}`);
        if (r.status !== "ACCEPTED") break;
        for (const x of r.signals) {
          after = x.seq;
          if (x.data.sdp) {
            await conn.setRemoteDescription(x.data.sdp as never);
            const answer = await conn.createAnswer();
            await conn.setLocalDescription(answer);
            await send({ sdp: conn.localDescription });
          } else if (x.data.candidate) await conn.addIceCandidate(x.data.candidate as never).catch(() => undefined);
        }
      } catch { /* try again */ }
      await new Promise((res) => setTimeout(res, 1000));
    }
    teardown(); void refresh();
  }

  if (!st?.enabled) return null;
  const req = st.request;
  return (
    <>
      {live && (
        <View accessibilityRole="alert" style={{ position: "absolute", top: 0, left: 0, right: 0, backgroundColor: C.danger, padding: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", zIndex: 50 }}>
          <Text style={{ color: "#fff", flex: 1, fontWeight: "600" }}>{live.helper} is helping you and can see your shared screen</Text>
          <Pressable accessibilityRole="button" onPress={() => void stop(live.id)} style={{ backgroundColor: "#fff", borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 }}><Text style={{ color: C.danger, fontWeight: "700" }}>Stop</Text></Pressable>
        </View>
      )}
      <Modal visible={st.needsTerms} animationType="slide" onRequestClose={() => undefined}>
        <View style={{ flex: 1, backgroundColor: C.bg, padding: 20, paddingTop: 48 }}>
          <Text style={{ fontSize: 20, fontWeight: "700", color: C.fg }}>Terms for company phone support</Text>
          <ScrollView style={{ flex: 1, marginVertical: 12 }}>
            <Text style={{ color: C.fg, lineHeight: 21 }}>{st.terms?.text}</Text>
            <Text style={{ color: C.fg, lineHeight: 21, marginTop: 12 }}>A support person may ask to help on this company phone. They must tell you why. You can say no every time. If you say yes, Android shows its own sharing prompt, they see only what you share, a red banner stays on screen with a Stop button, and each session is logged where you can read it.</Text>
          </ScrollView>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: ticked }} onPress={() => setTicked(!ticked)} style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
            <View style={{ width: 24, height: 24, borderWidth: 2, borderColor: C.primary, borderRadius: 6, marginRight: 10, alignItems: "center", justifyContent: "center", backgroundColor: ticked ? C.primary : "transparent" }}>{ticked && <Text style={{ color: "#fff" }}>✓</Text>}</View>
            <Text style={{ color: C.fg, flex: 1 }}>I have read the terms (version {st.terms?.version}) and I accept them.</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!ticked} onPress={async () => { await api("support", { method: "POST", body: { op: "accept_terms", version: st.terms?.version } }).catch((e) => setErr(String(e.message))); void refresh(); }} style={{ backgroundColor: ticked ? C.primary : C.border, padding: 14, borderRadius: 10, alignItems: "center" }}><Text style={{ color: "#fff", fontWeight: "700" }}>Accept and continue</Text></Pressable>
          {err && <Text style={{ color: C.danger, marginTop: 8 }}>{err}</Text>}
        </View>
      </Modal>
      <Modal visible={!!req && req.status === "REQUESTED" && !live} transparent animationType="fade" onRequestClose={() => undefined}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 24 }}>
          <View style={{ backgroundColor: C.surface, borderRadius: 14, padding: 18 }}>
            <Text style={{ fontSize: 17, fontWeight: "700", color: C.fg }}>{req?.helper} would like to help you on this phone</Text>
            <Text style={{ color: C.fg, marginTop: 8 }}>Reason: {req?.reason}</Text>
            <Text style={{ color: C.muted, marginTop: 8, fontSize: 13 }}>If you agree, Android will ask which screen to share. They see only that. A red banner stays on screen and you can stop at any time. Saying no has no consequences.</Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
              <Pressable accessibilityRole="button" onPress={() => req && void allow(req, st.iceServers)} style={{ flex: 1, backgroundColor: C.primary, padding: 12, borderRadius: 10, alignItems: "center" }}><Text style={{ color: "#fff", fontWeight: "700" }}>Allow</Text></Pressable>
              <Pressable accessibilityRole="button" onPress={async () => { if (req) await api("support", { method: "POST", body: { op: "respond", id: req.id, accept: false } }).catch(() => undefined); void refresh(); }} style={{ flex: 1, borderWidth: 1, borderColor: C.border, padding: 12, borderRadius: 10, alignItems: "center" }}><Text style={{ color: C.fg, fontWeight: "600" }}>No thanks</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
