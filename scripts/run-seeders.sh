#!/bin/sh
# Run all seed scripts against the local Redis REST proxy.
# Usage: ./scripts/run-seeders.sh
#
# Requires the worldmonitor stack to be running (uvx podman-compose up -d).
# The Redis REST proxy listens on localhost:8079 by default.

UPSTASH_REDIS_REST_URL="${UPSTASH_REDIS_REST_URL:-http://localhost:8079}"
UPSTASH_REDIS_REST_TOKEN="${UPSTASH_REDIS_REST_TOKEN:-wm-local-token}"
export UPSTASH_REDIS_REST_URL UPSTASH_REDIS_REST_TOKEN

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Source API keys from docker-compose.override.yml if present.
# These keys are configured for the container but seeders run on the host.
OVERRIDE="$PROJECT_DIR/docker-compose.override.yml"
if [ -f "$OVERRIDE" ]; then
  _env_tmp=$(mktemp)
  grep -E '^\s+[A-Z_]+:' "$OVERRIDE" \
    | grep -v '#' \
    | sed 's/^\s*//' \
    | sed 's/: */=/' \
    | sed "s/[\"']//g" \
    | grep -E '^(NASA_FIRMS|GROQ|AISSTREAM|FRED|FINNHUB|EIA|ACLED_ACCESS_TOKEN|ACLED_EMAIL|ACLED_PASSWORD|CLOUDFLARE|AVIATIONSTACK|OPENROUTER_API_KEY|LLM_API_URL|LLM_API_KEY|LLM_MODEL|OLLAMA_API_URL|OLLAMA_MODEL)' \
    | sed 's/^/export /' > "$_env_tmp"
  . "$_env_tmp"
  rm -f "$_env_tmp"
fi

ok=0 fail=0 skip=0

# Run a single seed script with exponential-backoff retry.
# Returns 0 on success, 1 on permanent failure, 2 on skip.
run_with_retry() {
  f="$1"
  name="$(basename "$f")"
  max_attempts=3
  attempt=1

  while [ $attempt -le $max_attempts ]; do
    output=$(node "$f" 2>&1)
    rc=$?
    last=$(echo "$output" | tail -1)

    if echo "$last" | grep -qi "skip\|not set\|missing.*key\|not found"; then
      printf "→ %s ... SKIP (%s)\n" "$name" "$last"
      return 2
    elif [ $rc -eq 0 ]; then
      if [ $attempt -gt 1 ]; then
        printf "→ %s ... OK (attempt %d/%d)\n" "$name" "$attempt" "$max_attempts"
      else
        printf "→ %s ... OK\n" "$name"
      fi
      return 0
    else
      if [ $attempt -lt $max_attempts ]; then
        delay=$((attempt * attempt))  # 1s, 4s (exponential backoff)
        printf "→ %s ... RETRY %d/%d in %ds (%s)\n" "$name" "$attempt" "$max_attempts" "$delay" "$last"
        sleep "$delay"
      else
        printf "→ %s ... FAIL after %d attempts (%s)\n" "$name" "$max_attempts" "$last"
      fi
      attempt=$((attempt + 1))
    fi
  done
  return 1
}

for f in "$SCRIPT_DIR"/seed-*.mjs; do
  run_with_retry "$f"
  rc=$?
  if [ $rc -eq 0 ]; then
    ok=$((ok + 1))
  elif [ $rc -eq 2 ]; then
    skip=$((skip + 1))
  else
    fail=$((fail + 1))
  fi
done

echo ""
echo "Done: $ok ok, $skip skipped, $fail failed"
