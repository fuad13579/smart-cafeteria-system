import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";
import StatusTimeline from "../components/StatusTimeline";
import { apiGetOrder, type OrderStatus } from "../lib/api";

type Props = NativeStackScreenProps<RootStackParamList, "Order">;

const steps: OrderStatus[] = ["QUEUED", "IN_PROGRESS", "READY", "COMPLETED", "CANCELLED"];
const terminalStates: OrderStatus[] = ["READY", "COMPLETED", "CANCELLED"];

export default function OrderScreen({ route, navigation }: Props) {
  const { id } = route.params;
  const [status, setStatus] = useState<OrderStatus>("QUEUED");
  const [eta, setEta] = useState(12);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let pollRef: ReturnType<typeof setInterval> | null = null;

    const load = async (showLoading = false) => {
      if (showLoading) setLoading(true);
      try {
        const res = await apiGetOrder(id);
        if (disposed) return;
        setErr(null);
        setStatus(res.status);
        setEta(Math.max(0, res.eta_minutes ?? 0));
        if (terminalStates.includes(res.status) && pollRef) {
          clearInterval(pollRef);
          pollRef = null;
        }
      } catch (e: any) {
        if (disposed) return;
        setErr(e?.message ?? "Failed to load order status");
      } finally {
        if (!disposed) setLoading(false);
      }
    };

    load(true);
    pollRef = setInterval(() => {
      if (terminalStates.includes(status)) return;
      load(false);
    }, 4000);

    return () => {
      disposed = true;
      if (pollRef) clearInterval(pollRef);
    };
  }, [id, status]);

  const activeIndex = useMemo(() => steps.indexOf(status), [status]);
  const retry = async () => {
    setLoading(true);
    try {
      const res = await apiGetOrder(id);
      setErr(null);
      setStatus(res.status);
      setEta(Math.max(0, res.eta_minutes ?? 0));
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load order status");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, padding: 18, gap: 12 }}>
      <Text style={{ color: "#fafafa", fontSize: 20, fontWeight: "700" }}>Order tracking</Text>
      <Text style={{ color: "#a1a1aa", fontSize: 13 }}>
        Order ID <Text style={{ color: "#e4e4e7" }}>{id}</Text>
      </Text>

      <View style={{ borderRadius: 18, borderWidth: 1, borderColor: "#18181b", padding: 14, gap: 10 }}>
        {loading && <Text style={{ color: "#a1a1aa", fontSize: 12 }}>Loading order status…</Text>}
        {err && (
          <View style={{ borderRadius: 12, borderWidth: 1, borderColor: "#92400e", padding: 10, backgroundColor: "rgba(146,64,14,0.2)" }}>
            <Text style={{ color: "#fde68a", fontSize: 12 }}>{err}</Text>
            <Pressable
              onPress={retry}
              style={{ marginTop: 8, borderRadius: 10, borderWidth: 1, borderColor: "#d97706", paddingVertical: 7, alignItems: "center" }}
            >
              <Text style={{ color: "#fde68a", fontSize: 12 }}>Retry now</Text>
            </Pressable>
          </View>
        )}

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
          <Text style={{ color: "#71717a", fontSize: 12, marginTop: 4 }}>Updates every 4 seconds while order is active.</Text>
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
