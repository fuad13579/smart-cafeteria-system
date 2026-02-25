import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, View, Text, Pressable } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";
import StatusTimeline from "../components/StatusTimeline";
import { apiOrderStatus, isMockMode, type OrderStatus } from "../lib/api";

type Props = NativeStackScreenProps<RootStackParamList, "Order">;

const steps = ["QUEUED", "IN_PROGRESS", "READY", "COMPLETED"] as const;

export default function OrderScreen({ route, navigation }: Props) {
  const { id } = route.params;
  const [status, setStatus] = useState<OrderStatus>("QUEUED");
  const [eta, setEta] = useState(12);
  const [refreshing, setRefreshing] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (isMockMode()) {
      const t = setInterval(async () => {
        try {
          const data = await apiOrderStatus(id);
          if (!alive) return;
          setStatus(data.status);
          setEta(data.eta_minutes);
          setRefreshing(false);
          if (data.status === "COMPLETED") clearInterval(t);
        } catch {
          if (!alive) return;
          setErr("Status sync failed.");
          setRefreshing(false);
        }
      }, 3000);
      void (async () => {
        const data = await apiOrderStatus(id);
        if (!alive) return;
        setStatus(data.status);
        setEta(data.eta_minutes);
        setRefreshing(false);
      })();
      return () => {
        alive = false;
        clearInterval(t);
      };
    }

    const poll = async () => {
      try {
        const data = await apiOrderStatus(id);
        if (!alive) return;
        setStatus(data.status);
        setEta(data.eta_minutes);
        setErr(null);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ?? "Status sync failed.");
      } finally {
        if (alive) setRefreshing(false);
      }
    };

    void poll();
    const t = setInterval(poll, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id]);

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
          {refreshing && <ActivityIndicator size="small" color="#fafafa" style={{ marginBottom: 8 }} />}
          <Text style={{ color: "#e4e4e7" }}>
            Estimated time: <Text style={{ fontWeight: "700" }}>{eta} min</Text>
          </Text>
          {err && <Text style={{ color: "#fecaca", fontSize: 12, marginTop: 4 }}>{err}</Text>}
          <Text style={{ color: "#71717a", fontSize: 12, marginTop: 4 }}>
            {isMockMode() ? "(Mock mode) Simulated status progression." : "Auto-refreshing every 4s."}
          </Text>
        </View>

        <Pressable
          onPress={() => navigation.navigate("Menu")}
          accessibilityRole="button"
          accessibilityLabel="Create new order"
          style={{ marginTop: 8, borderRadius: 14, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: "#27272a" }}
        >
          <Text style={{ color: "#fafafa" }}>New order</Text>
        </Pressable>
      </View>
    </View>
  );
}
