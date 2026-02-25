import React from "react";
import { Pressable, Text } from "react-native";

export default function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}) {
  const primary = variant === "primary";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        borderRadius: 14,
        paddingVertical: 12,
        alignItems: "center",
        backgroundColor: primary ? "#fafafa" : "transparent",
        borderWidth: primary ? 0 : 1,
        borderColor: "#27272a",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Text style={{ color: primary ? "#09090b" : "#fafafa", fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}