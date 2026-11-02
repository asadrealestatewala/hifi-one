import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from "react-native";
import { api, saveToken } from "../api";
import { Button, C, ErrorText, Muted } from "../ui";

type Done = { token: string };
type Step1 = Done | { mfaRequired: true; mfaToken: string };

export default function Login({ onDone }: { onDone: () => void }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setError("");
    try {
      const r = mfaToken
        ? await api<Done>("mfa", { method: "POST", body: { mfaToken, code } })
        : await api<Step1>("login", { method: "POST", body: { identifier, password } });
      if ("mfaRequired" in r) { setMfaToken(r.mfaToken); setCode(""); }
      else { await saveToken(r.token); onDone(); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      if (mfaToken && /timed out/i.test(String(e instanceof Error ? e.message : ""))) setMfaToken(null);
    }
    setBusy(false);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: C.navy, justifyContent: "center", padding: 24 }}>
      <Text style={{ color: "#fff", fontSize: 30, fontWeight: "800" }}>Hifi One</Text>
      <Text style={{ color: "#aeb4da", marginBottom: 24 }}>Hifi Marketing and Technologies</Text>
      <View style={{ backgroundColor: C.surface, borderRadius: 16, padding: 18, gap: 10 }}>
        {mfaToken ? (
          <>
            <Text style={{ fontWeight: "600" }}>Two-step verification</Text>
            <Muted>Enter the 6-digit code from your authenticator app, or a recovery code.</Muted>
            <Text style={lbl}>Code</Text>
            <TextInput value={code} onChangeText={setCode} keyboardType="number-pad" autoCapitalize="none" autoComplete="one-time-code" style={input} />
          </>
        ) : (
          <>
            <Text style={lbl}>Email or phone number</Text>
            <TextInput value={identifier} onChangeText={setIdentifier} autoCapitalize="none" autoComplete="username" keyboardType="email-address" style={input} />
            <Text style={lbl}>Password</Text>
            <TextInput value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" style={input} onSubmitEditing={submit} />
          </>
        )}
        <ErrorText>{error}</ErrorText>
        <Button title={mfaToken ? "Verify and sign in" : "Sign in"} onPress={submit} busy={busy} disabled={mfaToken ? !code.trim() : !identifier.trim() || !password} />
        {mfaToken ? <Button title="Start again" kind="ghost" onPress={() => { setMfaToken(null); setError(""); }} /> : null}
      </View>
      <Text style={{ color: "#aeb4da", marginTop: 16, fontSize: 12 }}>Forgot your password or need a setup link? Ask your administrator, or use the website.</Text>
    </KeyboardAvoidingView>
  );
}
const lbl = { fontSize: 13, fontWeight: "600" as const, color: C.fg };
const input = { borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, fontSize: 16, color: C.fg, backgroundColor: C.bg };
