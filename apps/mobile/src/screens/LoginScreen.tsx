import React, { useState } from "react";
import { ActivityIndicator, View, Text, TextInput, Pressable } from "react-native";
import * as SecureStore from "expo-secure-store";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";
import { apiLogin } from "../lib/api";
import { toast } from "../../components/Toast";

type Props = NativeStackScreenProps<RootStackParamList, "Login">;

export default function LoginScreen({ navigation }: Props) {
  const [studentId, setStudentId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = studentId.trim();
    if (!trimmed) {
      setErr("Student ID is required.");
      return;
    }
    if (!password.trim()) {
      setErr("Password is required.");
      return;
    }

    setErr(null);
    setBusy(true);
    try {
      const res = await apiLogin(trimmed, password);
      await SecureStore.setItemAsync("sc_token", res.access_token);
      await SecureStore.setItemAsync("sc_user", JSON.stringify(res.user));
      toast("Login successful");
      navigation.replace("Menu");
    } catch (e: any) {
      setErr(e?.message ?? "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, padding: 18, gap: 12 }}>
      <Text style={{ fontSize: 24, fontWeight: "600", color: "#fafafa" }}>Welcome back</Text>
      <Text style={{ fontSize: 13, color: "#a1a1aa" }}>Sign in with your IUT Student ID.</Text>

      <View style={{ marginTop: 12, borderRadius: 18, borderWidth: 1, borderColor: "#18181b", padding: 14 }}>
        <Text style={{ fontSize: 13, color: "#d4d4d8" }}>Student ID</Text>
        <TextInput
          value={studentId}
          onChangeText={setStudentId}
          placeholder="e.g. 2100xxx"
          placeholderTextColor="#52525b"
          accessibilityLabel="Student ID"
          accessibilityHint="Enter your IUT student ID"
          autoCapitalize="none"
          style={{
            marginTop: 8,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: "#27272a",
            paddingHorizontal: 12,
            paddingVertical: 10,
            color: "#fafafa",
          }}
        />

        <Text style={{ fontSize: 13, color: "#d4d4d8", marginTop: 12 }}>Password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••"
          placeholderTextColor="#52525b"
          accessibilityLabel="Password"
          accessibilityHint="Enter your account password"
          style={{
            marginTop: 8,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: "#27272a",
            paddingHorizontal: 12,
            paddingVertical: 10,
            color: "#fafafa",
          }}
        />

        {err && (
          <View style={{ marginTop: 12, borderRadius: 14, borderWidth: 1, borderColor: "#7f1d1d", padding: 10, backgroundColor: "rgba(127,29,29,0.12)" }}>
            <Text style={{ color: "#fecaca", fontSize: 13 }}>{err}</Text>
          </View>
        )}

        <Pressable
          onPress={submit}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
          accessibilityHint="Attempts login with your credentials"
          style={{
            marginTop: 14,
            borderRadius: 14,
            paddingVertical: 12,
            alignItems: "center",
            backgroundColor: "#fafafa",
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? <ActivityIndicator color="#09090b" /> : <Text style={{ color: "#09090b", fontWeight: "600" }}>Sign in</Text>}
        </Pressable>

        <Text style={{ marginTop: 10, fontSize: 12, color: "#71717a" }}>(Mock mode) Any ID works for now.</Text>
      </View>
    </View>
  );
}
