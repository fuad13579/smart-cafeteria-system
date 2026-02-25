import React, { useState } from "react";
import { View, Text, Pressable, FlatList } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";
import { useCart } from "../store/cart";
import { apiCreateOrder } from "../lib/api";
import { toast } from "../../components/Toast";

type Props = NativeStackScreenProps<RootStackParamList, "Cart">;

export default function CartScreen({ navigation }: Props) {
  const lines = useCart((s) => s.lines);
  const inc = useCart((s) => s.inc);
  const dec = useCart((s) => s.dec);
  const clear = useCart((s) => s.clear);
  const total = useCart((s) => s.total);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const totalValue = total();

  const place = async () => {
    setErr(null);
    setBusy(true);
    try {
      const res = await apiCreateOrder(lines.map((l) => ({ id: l.id, qty: l.qty })));
      toast("Order placed");
      clear();
      toast("Cart cleared");
      navigation.replace("Order", { id: res.order_id });
    } catch (e: any) {
      setErr(e?.message ?? "Order failed");
    } finally {
      setBusy(false);
    }
  };

  if (lines.length === 0) {
    return (
      <View style={{ flex: 1, padding: 18, gap: 12 }}>
        <Text style={{ color: "#fafafa", fontSize: 16, fontWeight: "600" }}>Your cart is empty</Text>
        <Pressable onPress={() => navigation.navigate("Menu")} style={{ borderRadius: 14, paddingVertical: 12, alignItems: "center", backgroundColor: "#fafafa" }}>
          <Text style={{ color: "#09090b", fontWeight: "600" }}>Browse menu</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 18 }}>
      <FlatList
        data={lines}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ gap: 10, paddingBottom: 18 }}
        renderItem={({ item }) => (
          <View style={{ borderRadius: 18, borderWidth: 1, borderColor: "#18181b", padding: 14 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <View>
                <Text style={{ color: "#fafafa", fontSize: 15, fontWeight: "600" }}>{item.name}</Text>
                <Text style={{ color: "#a1a1aa", fontSize: 12, marginTop: 3 }}>BDT {item.price}</Text>
              </View>
              <Text style={{ color: "#e4e4e7" }}>BDT {item.price * item.qty}</Text>
            </View>

            <View style={{ marginTop: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                <Pressable onPress={() => dec(item.id)} style={{ borderRadius: 12, borderWidth: 1, borderColor: "#27272a", paddingHorizontal: 12, paddingVertical: 8 }}>
                  <Text style={{ color: "#fafafa", fontSize: 16 }}>−</Text>
                </Pressable>
                <Text style={{ color: "#fafafa", minWidth: 24, textAlign: "center" }}>{item.qty}</Text>
                <Pressable onPress={() => inc(item.id)} style={{ borderRadius: 12, borderWidth: 1, borderColor: "#27272a", paddingHorizontal: 12, paddingVertical: 8 }}>
                  <Text style={{ color: "#fafafa", fontSize: 16 }}>+</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
        ListFooterComponent={
          <View style={{ borderRadius: 18, borderWidth: 1, borderColor: "#18181b", padding: 14, marginTop: 6 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: "#a1a1aa" }}>Total</Text>
              <Text style={{ color: "#fafafa", fontSize: 18, fontWeight: "700" }}>BDT {totalValue}</Text>
            </View>

            {err && (
              <View style={{ marginTop: 10, borderRadius: 14, borderWidth: 1, borderColor: "#7f1d1d", padding: 10, backgroundColor: "rgba(127,29,29,0.12)" }}>
                <Text style={{ color: "#fecaca", fontSize: 13 }}>{err}</Text>
              </View>
            )}

            <Pressable
              onPress={place}
              disabled={busy}
              style={{ marginTop: 12, borderRadius: 14, paddingVertical: 12, alignItems: "center", backgroundColor: "#fafafa", opacity: busy ? 0.7 : 1 }}
            >
              <Text style={{ color: "#09090b", fontWeight: "600" }}>{busy ? "Placing…" : "Place order"}</Text>
            </Pressable>

            <Pressable
              onPress={clear}
              style={{ marginTop: 10, borderRadius: 14, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: "#27272a" }}
            >
              <Text style={{ color: "#fafafa" }}>Clear cart</Text>
            </Pressable>
          </View>
        }
      />
    </View>
  );
}
