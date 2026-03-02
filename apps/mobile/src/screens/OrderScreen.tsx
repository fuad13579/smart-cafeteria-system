import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as SecureStore from "expo-secure-store";
import { RootStackParamList } from "../../App";
import StatusTimeline from "../components/StatusTimeline";
import { apiGetOrder, type OrderStatus } from "../lib/api";

type Props = NativeStackScreenProps<RootStackParamList, "Order">;

const steps: OrderStatus[] = ["QUEUED", "IN_PROGRESS", "READY", "COMPLETED", "CANCELLED"];
const terminalStates: OrderStatus[] = ["READY", "COMPLETED", "CANCELLED"];
const NOTIFICATION_WS_URL =
  process.env.EXPO_PUBLIC_NOTIFICATION_WS_URL || "ws://localhost:8005/ws";

export default function OrderScreen({ route, navigation }: Props) {
  const { id } = route.params;
  const [status, setStatus] = useState<OrderStatus>("QUEUED");
  const [eta, setEta] = useState(12);
  const [tokenNo, setTokenNo] = useState<number | null>(null);
  const [pickupCounter, setPickupCounter] = useState<number | null>(null);
  const [readyUntil, setReadyUntil] = useState<string | null>(null);
  const [serverExpired, setServerExpired] = useState(false);
  const [nowTs, setNowTs] = useState<number>(Date.now());
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
        setTokenNo(typeof res.token_no === "number" ? res.token_no : null);
        setPickupCounter(typeof res.pickup_counter === "number" ? res.pickup_counter : null);
        setEta(Math.max(0, res.eta_minutes ?? 0));
        setReadyUntil(typeof res.ready_until === "string" ? res.ready_until : null);
        setServerExpired(Boolean(res.is_expired));
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

  useEffect(() => {
    if (process.env.EXPO_PUBLIC_API_MODE !== "real") return;
    if (terminalStates.includes(status)) return;

    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = async () => {
      if (disposed) return;
      const token = await SecureStore.getItemAsync("sc_token");
      if (!token) return;

      const url = `${NOTIFICATION_WS_URL}?token=${encodeURIComponent(token)}`;
      socket = new WebSocket(url);

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload?.order_id !== id) return;
          const nextStatus = payload?.to_status as OrderStatus | undefined;
          if (!nextStatus) return;
          setStatus(nextStatus);
          if (typeof payload?.token_no === "number") setTokenNo(payload.token_no);
          if (typeof payload?.pickup_counter === "number") setPickupCounter(payload.pickup_counter);
          if (typeof payload?.ready_until === "string") setReadyUntil(payload.ready_until);
          if (typeof payload?.is_expired === "boolean") setServerExpired(payload.is_expired);
          if (typeof payload?.eta_minutes === "number") {
            setEta(Math.max(0, payload.eta_minutes));
          }
          setErr(null);
        } catch {
          // ignore malformed websocket events
        }
      };

      socket.onerror = () => {
        socket?.close();
      };

      socket.onclose = () => {
        if (disposed) return;
        reconnectTimer = setTimeout(() => {
          void connect();
        }, 3000);
      };
    };

    void connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socket) socket.close();
    };
  }, [id, status]);

  const activeIndex = useMemo(() => steps.indexOf(status), [status]);
  const retry = async () => {
    setLoading(true);
    try {
      const res = await apiGetOrder(id);
      setErr(null);
      setStatus(res.status);
      setTokenNo(typeof res.token_no === "number" ? res.token_no : null);
      setPickupCounter(typeof res.pickup_counter === "number" ? res.pickup_counter : null);
      setEta(Math.max(0, res.eta_minutes ?? 0));
      setReadyUntil(typeof res.ready_until === "string" ? res.ready_until : null);
      setServerExpired(Boolean(res.is_expired));
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load order status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const readyUntilDate = readyUntil ? new Date(readyUntil) : null;
  const readyDiffSec = readyUntilDate ? Math.floor((readyUntilDate.getTime() - nowTs) / 1000) : null;
  const readyExpired = status === "READY" && (serverExpired || (readyDiffSec !== null && readyDiffSec <= 0));
  const countdownLabel =
    readyDiffSec !== null && readyDiffSec > 0
      ? `${Math.floor(readyDiffSec / 60)
          .toString()
          .padStart(2, "0")}:${(readyDiffSec % 60).toString().padStart(2, "0")}`
      : null;

  return (
    <View style={{ flex: 1, padding: 18, gap: 12 }}>
      <Text style={{ color: "#fafafa", fontSize: 20, fontWeight: "700" }}>Order tracking</Text>
      <Text style={{ color: "#a1a1aa", fontSize: 13 }}>
        Order ID <Text style={{ color: "#e4e4e7" }}>{id}</Text>
      </Text>
      <Text style={{ color: "#a1a1aa", fontSize: 13 }}>
        Token <Text style={{ color: "#e4e4e7" }}>#{tokenNo ?? "-"}</Text> • Counter{" "}
        <Text style={{ color: "#e4e4e7" }}>{pickupCounter ?? "-"}</Text>
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
          {status === "READY" && (
            <View style={{ marginTop: 8, borderRadius: 10, borderWidth: 1, borderColor: readyExpired ? "#92400e" : "#065f46", padding: 8, backgroundColor: readyExpired ? "rgba(146,64,14,0.18)" : "rgba(6,95,70,0.16)" }}>
              {!readyExpired ? (
                <Text style={{ color: "#e5e7eb", fontSize: 12 }}>
                  Ready for pickup until{" "}
                  <Text style={{ fontWeight: "700" }}>{readyUntilDate ? readyUntilDate.toLocaleTimeString() : "-"}</Text>
                  {countdownLabel ? ` (${countdownLabel})` : ""}
                </Text>
              ) : (
                <Text style={{ color: "#fde68a", fontSize: 12 }}>Pickup window expired — go to counter.</Text>
              )}
            </View>
          )}
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
