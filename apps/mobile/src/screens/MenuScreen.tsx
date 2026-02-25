import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, FlatList, Image } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";
import { apiMenu, MenuItem } from "../lib/api";
import { useCart } from "../store/cart";
import * as SecureStore from "expo-secure-store";
import { logout } from "../lib/auth";
import { toast } from "../../components/Toast";

type Props = NativeStackScreenProps<RootStackParamList, "Menu">;

export default function MenuScreen({ navigation }: Props) {
  const add = useCart((s) => s.add);
  const cartCount = useCart((s) => s.lines.reduce((a, c) => a + c.qty, 0));

  const [items, setItems] = useState<MenuItem[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const data = await apiMenu();
        setItems(data);
      } catch (e: any) {
        setErr(e?.message ?? "Failed to load menu");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <Image
          source={require("../../assets/images/iut-logo.png")}
          style={{ width: 32, height: 32, borderRadius: 8, marginLeft: 12 }}
        />
      ),
      headerRight: () => (
        <Pressable
          onPress={() => navigation.navigate("Cart")}
          style={{
            position: "relative",
            borderRadius: 12,
            borderWidth: 1,
            borderColor: "#27272a",
            paddingHorizontal: 10,
            paddingVertical: 7,
          }}
        >
          <Text style={{ color: "#fafafa", fontSize: 12 }}>Cart</Text>

          {cartCount > 0 && (
            <View
              style={{
                position: "absolute",
                top: -6,
                right: -6,
                minWidth: 18,
                height: 18,
                borderRadius: 99,
                backgroundColor: "#fafafa",
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 5,
              }}
            >
              <Text style={{ color: "#09090b", fontSize: 11, fontWeight: "700" }}>{cartCount}</Text>
            </View>
          )}
        </Pressable>
      ),
    });
  }, [navigation, cartCount]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((i) => i.name.toLowerCase().includes(s));
  }, [items, q]);

  return (
    <View style={{ flex: 1, padding: 18 }}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search…"
          placeholderTextColor="#52525b"
          style={{
            flex: 1,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: "#27272a",
            paddingHorizontal: 12,
            paddingVertical: 10,
            color: "#fafafa",
          }}
        />
        <Pressable
          onPress={() => navigation.navigate("Cart")}
          style={{ borderRadius: 14, borderWidth: 1, borderColor: "#27272a", paddingHorizontal: 12, paddingVertical: 10 }}
        >
          <Text style={{ color: "#fafafa", fontSize: 13 }}>Cart ({cartCount})</Text>
        </Pressable>
      </View>

      {loading && <Text style={{ color: "#a1a1aa" }}>Loading menu…</Text>}
      {err && <Text style={{ color: "#fecaca" }}>{err}</Text>}

      <FlatList
        data={filtered}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ gap: 10, paddingBottom: 18 }}
        renderItem={({ item }) => (
          <View style={{ borderRadius: 18, borderWidth: 1, borderColor: "#18181b", padding: 14 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
              <View>
                <Text style={{ color: "#fafafa", fontSize: 15, fontWeight: "600" }}>{item.name}</Text>
                <Text style={{ color: "#a1a1aa", fontSize: 12, marginTop: 3 }}>BDT {item.price}</Text>
              </View>
              <View style={{ alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: item.available ? "#18181b" : "rgba(24,24,27,0.5)" }}>
                <Text style={{ color: item.available ? "#e4e4e7" : "#71717a", fontSize: 12 }}>
                  {item.available ? "Available" : "Sold out"}
                </Text>
              </View>
            </View>

            <Pressable
              disabled={!item.available}
              onPress={() => {
                add({ id: item.id, name: item.name, price: item.price, available: item.available });
                toast(`${item.name} added to cart`);
              }}
              style={{
                marginTop: 12,
                borderRadius: 14,
                paddingVertical: 12,
                alignItems: "center",
                backgroundColor: "#fafafa",
                opacity: item.available ? 1 : 0.4,
              }}
            >
              <Text style={{ color: "#09090b", fontWeight: "600" }}>Add to cart</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}