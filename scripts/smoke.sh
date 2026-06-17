#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${SMOKE_PORT:-15999}"
BASE="http://127.0.0.1:${PORT}"

cd "$ROOT/service-agent"

export NODE_ENV=test
export PORT="$PORT"
export DATABASE_PATH="${TMPDIR:-/tmp}/carshine-smoke-$$.sqlite"
export USE_MASTRA_AGENT=true

node server.js &
PID=$!
trap 'kill "$PID" 2>/dev/null || true' EXIT

for i in $(seq 1 30); do
  if curl -fsS "$BASE/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

curl -fsS "$BASE/health" | grep -q '"status"'
echo "✅ health ok"

BOOKING=$(curl -fsS -X POST "$BASE/api/public/bookings" \
  -H 'Content-Type: application/json' \
  -H "X-Idempotency-Key: smoke-$(date +%s)" \
  -d '{
    "customerName":"Smoke Test",
    "phone":"+201555599999",
    "area":"El Gouna",
    "carType":"Sedan",
    "servicePackageCode":"EXTERIOR_SEDAN",
    "address":"Smoke Marina",
    "preferredDate":"2099-12-01",
    "preferredTime":"10:00",
    "paymentMethod":"Cash",
    "source":"WEB_FORM",
    "language":"en"
  }')

echo "$BOOKING" | grep -q '"success":true'
echo "✅ public booking ok"

echo "Smoke test passed"
