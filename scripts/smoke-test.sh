#!/usr/bin/env bash
set -euo pipefail

: "${GATEWAY_BASE_URL:=http://localhost:8002}"
: "${ADMIN_BASE_URL:=http://localhost:3000}"
: "${STUDENT_ID:=2100001}"
: "${PASSWORD:=demo-pass}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: required command '$1' not found"
    exit 1
  fi
}

require_cmd curl
require_cmd python3

json_get() {
  python3 -c 'import json,sys; data=json.loads(sys.stdin.read());
key=sys.argv[1];
cur=data
for p in key.split("."):
    if isinstance(cur, dict):
        cur=cur.get(p)
    else:
        cur=None
        break
print("" if cur is None else cur)' "$1"
}

request() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  local auth="${4:-}"

  local tmp_body
  tmp_body="$(mktemp)"
  local code

  if [[ -n "$body" && -n "$auth" ]]; then
    code=$(curl -sS -o "$tmp_body" -w "%{http_code}" -X "$method" "$url" -H "Content-Type: application/json" -H "Authorization: Bearer $auth" -d "$body")
  elif [[ -n "$body" ]]; then
    code=$(curl -sS -o "$tmp_body" -w "%{http_code}" -X "$method" "$url" -H "Content-Type: application/json" -d "$body")
  elif [[ -n "$auth" ]]; then
    code=$(curl -sS -o "$tmp_body" -w "%{http_code}" -X "$method" "$url" -H "Authorization: Bearer $auth")
  else
    code=$(curl -sS -o "$tmp_body" -w "%{http_code}" -X "$method" "$url")
  fi

  echo "$code"
  cat "$tmp_body"
  rm -f "$tmp_body"
}

echo "[1/5] Login"
login_payload=$(printf '{"student_id":"%s","password":"%s"}' "$STUDENT_ID" "$PASSWORD")
login_result="$(request POST "$GATEWAY_BASE_URL/api/login" "$login_payload")"
login_code="$(echo "$login_result" | sed -n '1p')"
login_body="$(echo "$login_result" | sed '1d')"
if [[ "$login_code" != "200" ]]; then
  echo "Login failed: HTTP $login_code"
  echo "$login_body"
  exit 1
fi
TOKEN="$(echo "$login_body" | json_get access_token)"
if [[ -z "$TOKEN" ]]; then
  echo "Login response missing access_token"
  echo "$login_body"
  exit 1
fi

echo "[2/5] Get menu"
menu_result="$(request GET "$GATEWAY_BASE_URL/api/menu" "" "$TOKEN")"
menu_code="$(echo "$menu_result" | sed -n '1p')"
menu_body="$(echo "$menu_result" | sed '1d')"
if [[ "$menu_code" != "200" ]]; then
  echo "Menu failed: HTTP $menu_code"
  echo "$menu_body"
  exit 1
fi
first_item_id="$(echo "$menu_body" | python3 -c 'import json,sys
d=json.loads(sys.stdin.read())
items=d.get("items", [])
available=[i for i in items if i.get("available") is True]
print((available[0] if available else {}).get("id",""))')"
if [[ -z "$first_item_id" ]]; then
  echo "Menu has no available items"
  echo "$menu_body"
  exit 1
fi

echo "[3/5] Create order"
order_payload=$(printf '{"items":[{"id":"%s","qty":1}]}' "$first_item_id")
order_result="$(request POST "$GATEWAY_BASE_URL/api/orders" "$order_payload" "$TOKEN")"
order_code="$(echo "$order_result" | sed -n '1p')"
order_body="$(echo "$order_result" | sed '1d')"
if [[ "$order_code" != "200" ]]; then
  echo "Create order failed: HTTP $order_code"
  echo "$order_body"
  exit 1
fi
order_id="$(echo "$order_body" | json_get order_id)"
if [[ -z "$order_id" ]]; then
  echo "Create order response missing order_id"
  echo "$order_body"
  exit 1
fi

echo "[4/5] Get order status"
status_result="$(request GET "$GATEWAY_BASE_URL/api/orders/$order_id" "" "$TOKEN")"
status_code="$(echo "$status_result" | sed -n '1p')"
status_body="$(echo "$status_result" | sed '1d')"
if [[ "$status_code" != "200" ]]; then
  echo "Order status failed: HTTP $status_code"
  echo "$status_body"
  exit 1
fi

state="$(echo "$status_body" | json_get status)"
if [[ -z "$state" ]]; then
  echo "Order status response missing status"
  echo "$status_body"
  exit 1
fi
if [[ ! "$state" =~ ^(QUEUED|IN_PROGRESS|READY|COMPLETED|CANCELLED)$ ]]; then
  echo "Order status is invalid: $state"
  echo "$status_body"
  exit 1
fi

eta_minutes="$(echo "$status_body" | json_get eta_minutes)"
if ! [[ "$eta_minutes" =~ ^[0-9]+$ ]]; then
  echo "Order status response has non-numeric eta_minutes: $eta_minutes"
  echo "$status_body"
  exit 1
fi

echo "[5/5] Check admin metrics keys"
metrics_result="$(request GET "$ADMIN_BASE_URL/api/admin/metrics")"
metrics_code="$(echo "$metrics_result" | sed -n '1p')"
metrics_body="$(echo "$metrics_result" | sed '1d')"
if [[ "$metrics_code" != "200" ]]; then
  echo "Admin metrics failed: HTTP $metrics_code"
  echo "$metrics_body"
  exit 1
fi

python3 -c 'import json,sys
obj=json.loads(sys.argv[1])
required=["latency_ms_p50","latency_ms_p95","orders_per_min","queue_depth","updatedAt"]
missing=[k for k in required if k not in obj]
if missing:
    print("Missing metrics keys:", ", ".join(missing))
    raise SystemExit(1)
print("Metrics keys check passed")
' "$metrics_body"

echo "Smoke test passed."
