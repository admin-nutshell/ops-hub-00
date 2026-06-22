#!/usr/bin/env bash
# provision-uptimerobot.sh
# Creates 3 UptimeRobot HTTP monitors for ops-hub staging services.
#
# Requires: UPTIMEROBOT_API_KEY (Main API key from UptimeRobot account settings)
# Safe to re-run: treats error type "already_exists" as a non-fatal skip.
#
# UptimeRobot API v2: https://uptimerobot.com/api/
# POST https://api.uptimerobot.com/v2/newMonitor
# Parameters are form-encoded; format=json controls the response format only.
#
# ALERT CONTACTS: Left empty per T-14 initial scope.
# Action required: configure alert contacts in UptimeRobot dashboard
# (Monitors > Alert Contacts > Add) and update this script with the
# alert_contacts parameter to wire email notifications to mai@leelaecospa.com.

set -euo pipefail

UPTIMEROBOT_API="https://api.uptimerobot.com/v2/newMonitor"

if [ -z "${UPTIMEROBOT_API_KEY:-}" ]; then
  echo "ERROR: UPTIMEROBOT_API_KEY is not set." >&2
  exit 1
fi

# create_monitor <friendly_name> <url>
# Returns 0 on success or already-exists; returns 1 on any other error.
create_monitor() {
  local name="$1"
  local url="$2"

  echo ""
  echo "=== Creating monitor: $name ==="
  echo "    URL: $url"

  # UptimeRobot v2 API is form-encoded.
  # type=1 = HTTP(s). interval omitted — free plan rejects it even at the default 300s.
  # alert_contacts intentionally omitted — see header note.
  local response
  response=$(curl -s --max-time 30 \
    -X POST "$UPTIMEROBOT_API" \
    --data-urlencode "api_key=${UPTIMEROBOT_API_KEY}" \
    --data-urlencode "format=json" \
    --data-urlencode "type=1" \
    --data-urlencode "url=${url}" \
    --data-urlencode "friendly_name=${name}")

  echo "Response: $response"

  # Parse stat field from JSON response
  local stat
  stat=$(echo "$response" | grep -o '"stat":"[^"]*"' | sed 's/"stat":"//;s/"//')

  if [ "$stat" = "ok" ]; then
    echo "SUCCESS: Monitor created for $name"
    return 0
  fi

  # Check for already_exists (error type 460) — treat as non-fatal skip
  local error_type
  error_type=$(echo "$response" | grep -o '"type":"[^"]*"' | head -1 | sed 's/"type":"//;s/"//')
  if [ "$stat" = "fail" ] && [ "$error_type" = "already_exists" ]; then
    echo "SKIP: Monitor already exists for $name (error type: already_exists)"
    return 0
  fi

  echo "ERROR: Unexpected response for $name (stat=$stat)" >&2
  echo "Full response: $response" >&2
  return 1
}

ERRORS=0

create_monitor "ops-hub-app (staging)" \
  "https://ops-hub-staging.inatechshell.ca/health" \
  || ERRORS=$((ERRORS + 1))

create_monitor "LiteLLM (staging)" \
  "http://h12xz8887fxvbvjts2hac8if.187.124.76.235.sslip.io/health" \
  || ERRORS=$((ERRORS + 1))

create_monitor "FreeScout (staging)" \
  "http://y4b8nibdtizby6ys3el2gad4.187.124.76.235.sslip.io" \
  || ERRORS=$((ERRORS + 1))

echo ""
if [ "$ERRORS" -eq 0 ]; then
  echo "=== All 3 monitors provisioned successfully ==="
else
  echo "=== Provisioning completed with $ERRORS error(s) ===" >&2
  exit 1
fi
