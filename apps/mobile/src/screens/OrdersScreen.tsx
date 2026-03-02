import React, { useEffect, useState } from "react";
import { View, Text, FlatList, Pressable } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";
import { apiGetMyOrders, type OrderDetails } from "../lib/api";

type Props = NativeStackScreenProps<RootStackParamList, "Orders">;

export default function OrdersScreen({ navigation }: Props) {
  const [orders, setOrders] = useState<OrderDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setErr(null);
      const res = await apiGetMyOrders();
      setOrders(Array.isArray(res?.orders) ? res.orders : []);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load orders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <View style={{ flex: 1, padding: 18 }}>
      <Text style={{ color: "#fafafa", fontSize: 20, fontWeight: "700", marginBottom: 12 }}>Orders</Text>
      {loading && <Text style={{ color: "#a1a1aa" }}>Loading orders…</Text>}
      {err && <Text style={{ color: "#fecaca", marginBottom: 10 }}>{err}</Text>}

      <FlatList
        data={orders}
        keyExtractor={(item) => item.order_id}
        contentContainerStyle={{ gap: 10, paddingBottom: 20 }}
        ListEmptyComponent={
          !loading ? <Text style={{ color: "#a1a1aa" }}>No orders yet.</Text> : null
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => navigation.navigate("Order", { id: item.order_id })}
            style={{ borderRadius: 16, borderWidth: 1, borderColor: "#18181b", padding: 12 }}
          >
            <Text style={{ color: "#fafafa", fontWeight: "600" }}>Order #{item.order_id}</Text>
            <Text style={{ color: "#a1a1aa", marginTop: 3 }}>
              Token #{item.token_no ?? "-"} • {item.status}
            </Text>
            <Text style={{ color: "#d4d4d8", marginTop: 3 }}>BDT {item.total_amount ?? 0}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}
