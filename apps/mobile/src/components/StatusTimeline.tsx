import React from "react";
import { View, Text } from "react-native";

export default function StatusTimeline({
  steps,
  activeIndex,
}: {
  steps: string[];
  activeIndex: number;
}) {
  return (
    <View style={{ gap: 10 }}>
      {steps.map((s, idx) => {
        const active = idx <= activeIndex;
        return (
          <View key={s} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 99,
                backgroundColor: active ? "#fafafa" : "#27272a",
              }}
            />
            <Text style={{ color: active ? "#fafafa" : "#71717a" }}>{s.replace("_", " ")}</Text>
          </View>
        );
      })}
    </View>
  );
}