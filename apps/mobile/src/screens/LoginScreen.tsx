import React, { useState } from "react";
import { View, Text, TextInput, Pressable } from "react-native";
import * as SecureStore from "expo-secure-store";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";
import { apiLogin, apiRegister } from "../lib/api";
import { toast } from "../../components/Toast";

type Props = NativeStackScreenProps<RootStackParamList, "Login">;

export default function LoginScreen({ navigation }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [fullName, setFullName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      const res =
        mode === "login"
          ? await apiLogin(studentId.trim(), password)
          : await apiRegister({
              full_name: fullName.trim(),
              student_id: studentId.trim(),
              email: email.trim(),
              password,
            });
      await SecureStore.setItemAsync("sc_token", res.access_token);
      await SecureStore.setItemAsync("sc_user", JSON.stringify(res.user));
      toast(mode === "login" ? "Login successful" : "Account created");
      navigation.replace("Menu");
    } catch (e: any) {
      setErr(e?.message ?? (mode === "login" ? "Login failed" : "Registration failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, padding: 18, gap: 12 }}>
      <Text style={{ fontSize: 24, fontWeight: "600", color: "#fafafa" }}>Welcome back</Text>
      <Text style={{ fontSize: 13, color: "#a1a1aa" }}>
        {mode === "login" ? "Sign in with your IUT Student ID." : "Create your student account."}
      </Text>

      <View style={{ marginTop: 12, borderRadius: 18, borderWidth: 1, borderColor: "#18181b", padding: 14 }}>
        {mode === "register" && (
          <>
            <Text style={{ fontSize: 13, color: "#d4d4d8" }}>Student Name</Text>
            <TextInput
              value={fullName}
              onChangeText={setFullName}
              placeholder="e.g. Fuad Bin Sattar"
              placeholderTextColor="#52525b"
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
          </>
        )}

        <Text style={{ fontSize: 13, color: "#d4d4d8" }}>Student ID</Text>
        <TextInput
          value={studentId}
          onChangeText={setStudentId}
          placeholder="e.g. 2100xxx"
          placeholderTextColor="#52525b"
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

        {mode === "register" && (
          <>
            <Text style={{ fontSize: 13, color: "#d4d4d8", marginTop: 12 }}>Student Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="e.g. student@iut.edu"
              placeholderTextColor="#52525b"
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
          </>
        )}

        <Text style={{ fontSize: 13, color: "#d4d4d8", marginTop: 12 }}>Password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••"
          placeholderTextColor="#52525b"
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
          style={{
            marginTop: 14,
            borderRadius: 14,
            paddingVertical: 12,
            alignItems: "center",
            backgroundColor: "#fafafa",
            opacity: busy ? 0.7 : 1,
          }}
        >
          <Text style={{ color: "#09090b", fontWeight: "600" }}>
            {busy ? (mode === "login" ? "Signing in…" : "Creating…") : mode === "login" ? "Sign in" : "Create account"}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => {
            setErr(null);
            setMode((prev) => (prev === "login" ? "register" : "login"));
          }}
          style={{
            marginTop: 10,
            borderRadius: 14,
            paddingVertical: 10,
            alignItems: "center",
            borderWidth: 1,
            borderColor: "#27272a",
          }}
        >
          <Text style={{ color: "#fafafa" }}>
            {mode === "login" ? "First time? Create account" : "Already have an account? Sign in"}
          </Text>
        </Pressable>

        <Text style={{ marginTop: 10, fontSize: 12, color: "#71717a" }}>
          {mode === "login"
            ? "Use your Student ID and password."
            : "Required: Student Name, Student ID, Student Email, Password."}
        </Text>
      </View>
    </View>
  );
}
