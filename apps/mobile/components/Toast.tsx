import React, { useEffect, useState } from "react";
import { View, Text } from "react-native";

let pushToast: ((msg: string) => void) | null = null;

export function toast(msg: string) {
  pushToast?.(msg);
}

export default function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    pushToast = (m: string) => {
      setMsg(m);
      setTimeout(() => setMsg(null), 1400);
    };
    return () => {
      pushToast = null;
    };
  }, []);

  if (!msg) return null;

  return (
    <View
      style={{
        position: "absolute",
        left: 16,
        right: 16,
        bottom: 24,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "#27272a",
        backgroundColor: "rgba(9,9,11,0.92)",
        paddingVertical: 12,
        paddingHorizontal: 14,
      }}
    >
      <Text style={{ color: "#e4e4e7", fontSize: 13 }}>{msg}</Text>
    </View>
  );
}