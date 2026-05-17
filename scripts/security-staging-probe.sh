#!/usr/bin/env bash
set -euo pipefail

required_vars=(
  STAGING_PRIVATE_MEDIA_URL
  STAGING_COLLAB_MEDIA_URL
  STAGING_ADMIN_BEARER_TOKEN
  STAGING_COLLAB_BEARER_TOKEN
)

missing=0
for var in "${required_vars[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "[security-probe] Missing required env var: ${var}"
    missing=1
  elif [[ "${!var}" == __REPLACE_* ]] || [[ "${!var}" == CHANGE_ME* ]]; then
    echo "[security-probe] Placeholder value for env var: ${var}"
    missing=1
  fi
done

if [[ "$missing" -eq 1 ]]; then
  echo "[security-probe] Required variables are missing. Skipping probe run."
  exit 0
fi

PROBE_TMPDIR="$(mktemp -d)"
trap 'rm -rf "$PROBE_TMPDIR"' EXIT

code_for_get() {
  local url="$1"
  local token="${2:-}"
  local body_file="${PROBE_TMPDIR}/body_$(date +%s%N)"
  if [[ -n "$token" ]]; then
    curl -s -o "$body_file" -w "%{http_code}" -H "Authorization: Bearer ${token}" "$url"
  else
    curl -s -o "$body_file" -w "%{http_code}" "$url"
  fi
}

code_for_zip() {
  local url="$1"
  local body="$2"
  local token="${3:-}"
  local body_file="${PROBE_TMPDIR}/body_$(date +%s%N)"
  if [[ -n "$token" ]]; then
    curl -s -o "$body_file" -w "%{http_code}" \
      -X POST \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${token}" \
      --data "$body" \
      "$url"
  else
    curl -s -o "$body_file" -w "%{http_code}" \
      -X POST \
      -H "Content-Type: application/json" \
      --data "$body" \
      "$url"
  fi
}

assert_status_in() {
  local actual="$1"
  local name="$2"
  shift 2
  local expected=("$@")
  for status in "${expected[@]}"; do
    if [[ "$actual" == "$status" ]]; then
      echo "[security-probe] PASS ${name}: ${actual}"
      return 0
    fi
  done
  echo "[security-probe] FAIL ${name}: got ${actual}, expected one of: ${expected[*]}"
  # Show most recent response body for debugging
  local latest_body
  latest_body="$(ls -t "$PROBE_TMPDIR"/body_* 2>/dev/null | head -1)"
  if [[ -n "$latest_body" && -s "$latest_body" ]]; then
    echo "[security-probe]   response body: $(head -c 500 "$latest_body")"
  fi
  return 1
}

failures=0

# 1) Unauthenticated requests to private/collaborators-only media must be denied.
private_anon="$(code_for_get "$STAGING_PRIVATE_MEDIA_URL")"
assert_status_in "$private_anon" "private media (anon denied)" 401 403 404 || failures=$((failures + 1))

collab_anon="$(code_for_get "$STAGING_COLLAB_MEDIA_URL")"
assert_status_in "$collab_anon" "collab media (anon denied)" 401 403 404 || failures=$((failures + 1))

# 2) Authenticated access with correct roles should work.
private_admin="$(code_for_get "$STAGING_PRIVATE_MEDIA_URL" "$STAGING_ADMIN_BEARER_TOKEN")"
assert_status_in "$private_admin" "private media (admin allowed)" 200 404 || failures=$((failures + 1))

collab_allowed="$(code_for_get "$STAGING_COLLAB_MEDIA_URL" "$STAGING_COLLAB_BEARER_TOKEN")"
assert_status_in "$collab_allowed" "collab media (collaborator allowed)" 200 404 || failures=$((failures + 1))

# Optional ZIP probes if URL/body are provided.
if [[ -n "${STAGING_PRIVATE_ZIP_URL:-}" && -n "${STAGING_PRIVATE_ZIP_BODY:-}" ]]; then
  private_zip_anon="$(code_for_zip "$STAGING_PRIVATE_ZIP_URL" "$STAGING_PRIVATE_ZIP_BODY")"
  assert_status_in "$private_zip_anon" "private ZIP (anon denied)" 401 403 404 || failures=$((failures + 1))

  private_zip_admin="$(code_for_zip "$STAGING_PRIVATE_ZIP_URL" "$STAGING_PRIVATE_ZIP_BODY" "$STAGING_ADMIN_BEARER_TOKEN")"
  assert_status_in "$private_zip_admin" "private ZIP (admin allowed)" 200 404 || failures=$((failures + 1))
fi

if [[ "$failures" -gt 0 ]]; then
  echo "[security-probe] Completed with ${failures} failing checks."
  exit 1
fi

echo "[security-probe] All checks passed."
