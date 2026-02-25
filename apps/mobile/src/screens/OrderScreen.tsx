import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";
import StatusTimeline from "../components/StatusTimeline";

type Props = NativeStackScreenProps<RootStackParamList, "Order">;

const steps = ["QUEUED", "IN_PROGRESS", "READY", "COMPLETED"] as const;

export default function OrderScreen({ route, navigation }: Props) {
  const { id } = route.params;
  const [status, setStatus] = useState<(typeof steps)[number]>("QUEUED");
  const [eta, setEta] = useState(12);

  // mock progression (replace later with websocket)
  useEffect(() => {
    const seq: (typeof steps)[number][] = ["QUEUED", "IN_PROGRESS", "READY", "COMPLETED"];
    let i = 0;
    const t = setInterval(() => {
      i = Math.min(i + 1, seq.length - 1);
      setStatus(seq[i]);
      setEta((x) => Math.max(0, x - 3));
      if (i === seq.length - 1) clearInterval(t);
    }, 3500);
    return () => clearInterval(t);
  }, []);

  const activeIndex = useMemo(() => steps.indexOf(status), [status]);

  return (
    <View style={{ flex: 1, padding: 18, gap: 12 }}>
      <Text style={{ color: "#fafafa", fontSize: 20, fontWeight: "700" }}>Order tracking</Text>
      <Text style={{ color: "#a1a1aa", fontSize: 13 }}>
        Order ID <Text style={{ color: "#e4e4e7" }}>{id}</Text>
      </Text>

      <View style={{ borderRadius: 18, borderWidth: 1, borderColor: "#18181b", padding: 14, gap: 10 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ color: "#a1a1aa" }}>Current status</Text>
          <View style={{ backgroundColor: "#18181b", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 }}>
            <Text style={{ color: "#e4e4e7", fontSize: 12 }}>{status}</Text>
          </View>
        </View>

        <StatusTimeline steps={[...steps]} activeIndex={activeIndex} />

        <View style={{ marginTop: 6, borderRadius: 14, borderWidth: 1, borderColor: "#27272a", padding: 10 }}>
          <Text style={{ color: "#e4e4e7" }}>
            Estimated time: <Text style={{ fontWeight: "700" }}>{eta} min</Text>
          </Text>
          <Text style={{ color: "#71717a", fontSize: 12, marginTop: 4 }}>(Mock mode) Will be real-time later.</Text>
        </View>

        <Pressable
          onPress={() => navigation.navigate("Menu")}
          style={{ marginTop: 8, borderRadius: 14, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: "#27272a" }}
        >
          <Text style={{ color: "#fafafa" }}>New order</Text>
        </Pressable>
      </View>
    </View>
  );
}
