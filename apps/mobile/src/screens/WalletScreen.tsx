import React, { useEffect, useState } from "react";
import { View, Text, Pressable, FlatList } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";
import {
  apiWalletBalance,
  apiWalletTopup,
  apiWalletTransactions,
  type WalletMethod,
  type WalletTx,
} from "../lib/api";
import { toast } from "../../components/Toast";

type Props = NativeStackScreenProps<RootStackParamList, "Wallet">;

const quickAmounts = [100, 200, 500, 1000];

export default function WalletScreen(_props: Props) {
  const [balance, setBalance] = useState<number>(0);
  const [tx, setTx] = useState<WalletTx[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try {
      setErr(null);
      const [b, t] = await Promise.all([apiWalletBalance(), apiWalletTransactions("all")]);
      setBalance(Number(b?.account_balance ?? 0));
      setTx(Array.isArray(t?.transactions) ? t.transactions : []);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load wallet");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const topup = async (amount: number, method: WalletMethod) => {
    try {
      setBusy(true);
      setErr(null);
      const res = await apiWalletTopup(amount, method);
      if (typeof res?.account_balance === "number") {
        setBalance(res.account_balance);
      } else {
        const b = await apiWalletBalance();
        setBalance(Number(b?.account_balance ?? 0));
      }
      const t = await apiWalletTransactions("all");
      setTx(Array.isArray(t?.transactions) ? t.transactions : []);
      toast(method === "BANK" ? "Top-up submitted (pending)" : "Top-up successful");
    } catch (e: any) {
      setErr(e?.message ?? "Top-up failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, padding: 18 }}>
      <Text style={{ color: "#fafafa", fontSize: 20, fontWeight: "700" }}>Wallet</Text>
      <View style={{ marginTop: 12, borderRadius: 16, borderWidth: 1, borderColor: "#18181b", padding: 14 }}>
        <Text style={{ color: "#a1a1aa" }}>Current balance</Text>
        <Text style={{ color: "#fafafa", fontSize: 28, fontWeight: "700", marginTop: 4 }}>BDT {balance}</Text>
      </View>

      <Text style={{ color: "#d4d4d8", marginTop: 14, marginBottom: 8 }}>Quick add money</Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {quickAmounts.map((a) => (
          <Pressable
            key={a}
            disabled={busy}
            onPress={() => topup(a, "BKASH")}
            style={{ borderRadius: 12, borderWidth: 1, borderColor: "#27272a", paddingHorizontal: 12, paddingVertical: 9 }}
          >
            <Text style={{ color: "#fafafa" }}>BDT {a}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
        <Pressable
          disabled={busy}
          onPress={() => topup(500, "BKASH")}
          style={{ flex: 1, borderRadius: 12, paddingVertical: 11, alignItems: "center", backgroundColor: "#fafafa" }}
        >
          <Text style={{ color: "#09090b", fontWeight: "600" }}>bKash 500</Text>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={() => topup(500, "NAGAD")}
          style={{ flex: 1, borderRadius: 12, paddingVertical: 11, alignItems: "center", backgroundColor: "#fafafa" }}
        >
          <Text style={{ color: "#09090b", fontWeight: "600" }}>Nagad 500</Text>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={() => topup(500, "BANK")}
          style={{ flex: 1, borderRadius: 12, paddingVertical: 11, alignItems: "center", borderWidth: 1, borderColor: "#27272a" }}
        >
          <Text style={{ color: "#fafafa", fontWeight: "600" }}>Bank 500</Text>
        </Pressable>
      </View>

      {err && <Text style={{ color: "#fecaca", marginTop: 10 }}>{err}</Text>}

      <Text style={{ color: "#d4d4d8", marginTop: 16, marginBottom: 8 }}>Transaction history</Text>
      <FlatList
        data={tx}
        keyExtractor={(item) => item.transaction_id}
        contentContainerStyle={{ gap: 8, paddingBottom: 20 }}
        ListEmptyComponent={<Text style={{ color: "#a1a1aa" }}>No transactions yet.</Text>}
        renderItem={({ item }) => (
          <View style={{ borderRadius: 12, borderWidth: 1, borderColor: "#18181b", padding: 10 }}>
            <Text style={{ color: "#fafafa", fontWeight: "600" }}>
              {item.method} • BDT {item.amount}
            </Text>
            <Text style={{ color: "#a1a1aa", marginTop: 2 }}>
              {item.status} • {item.created_at ? new Date(item.created_at).toLocaleString() : "-"}
            </Text>
          </View>
        )}
      />
    </View>
  );
}
