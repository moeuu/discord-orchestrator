#!/usr/bin/env bash

if [ -n "${DISCORD_AUTOPILOT_HOOK_LOADED:-}" ]; then
  return 0 2>/dev/null || exit 0
fi

DISCORD_AUTOPILOT_HOOK_LOADED=1
export DISCORD_AUTOPILOT_HOOK_LOADED

if [ -z "${DISCORD_AUTOPILOT_REAL_UV:-}" ]; then
  DISCORD_AUTOPILOT_REAL_UV="$(command -v uv)"
  export DISCORD_AUTOPILOT_REAL_UV
fi

if [ -z "${DISCORD_AUTOPILOT_REAL_UV:-}" ]; then
  echo "autopilot-shell-hook: uv が見つかりません" >&2
  return 1 2>/dev/null || exit 1
fi

discord_autopilot_now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

discord_autopilot_slug() {
  printf "%s" "$1" |
    tr '[:upper:]' '[:lower:]' |
    sed -E 's#^https?://[^/]+/##' |
    sed -E 's#^c/##' |
    sed -E 's#/+$##' |
    awk -F/ '{print $NF}' |
    sed -E 's/[^a-z0-9-]+/-/g'
}

discord_autopilot_goal() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --goal)
        shift
        printf "%s" "${1:-}"
        return 0
        ;;
    esac
    shift
  done
  return 0
}

discord_autopilot_write_manifest() {
  python3 - "$@" <<'PY'
import json
import sys

(
    manifest_path,
    session_id,
    command,
    cwd,
    host,
    competition,
    instruction,
    artifact_root,
    log_path,
    started_at,
    updated_at,
    status,
    exit_code,
    finished_at,
) = sys.argv[1:]

payload = {
    "session_id": session_id,
    "command": command,
    "cwd": cwd,
    "host": host,
    "competition": competition,
    "instruction": instruction,
    "artifact_root": artifact_root,
    "log_path": log_path,
    "started_at": started_at,
    "updated_at": updated_at,
    "status": status,
    "exit_code": None if exit_code == "" else int(exit_code),
    "finished_at": None if finished_at == "" else finished_at,
}

with open(manifest_path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, ensure_ascii=True, indent=2)
    handle.write("\n")
PY
}

uv() {
  if [ "$1" = "run" ] && [ "$2" = "kagglebot" ] && [ "$3" = "autopilot" ] && [ -n "${4:-}" ]; then
    local competition="$4"
    local session_root="${DISCORD_AUTOPILOT_SESSION_DIR:-$HOME/.discord-orchestrator/autopilot-sessions}"
    local session_id
    session_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
    local session_dir="${session_root}/${session_id}"
    local log_path="${session_dir}/console.log"
    local started_at
    started_at="$(discord_autopilot_now)"
    local instruction
    instruction="$(discord_autopilot_goal "$@")"
    local slug
    slug="$(discord_autopilot_slug "$competition")"
    local artifacts_base="${AUTOPILOT_ARTIFACTS_DIR:-$PWD/artifacts}"
    local artifact_root="${artifacts_base}/${slug}"
    local command_string
    command_string="$(printf '%q ' "$@")"
    command_string="${command_string% }"

    mkdir -p "$session_dir"
    : >"$log_path"

    discord_autopilot_write_manifest \
      "${session_dir}/session.json" \
      "$session_id" \
      "uv ${command_string}" \
      "$PWD" \
      "$(hostname)" \
      "$competition" \
      "$instruction" \
      "$artifact_root" \
      "$log_path" \
      "$started_at" \
      "$started_at" \
      "running" \
      "" \
      ""

    (
      set -o pipefail
      "$DISCORD_AUTOPILOT_REAL_UV" "$@" 2>&1 | tee -a "$log_path"
    )
    local exit_code=$?
    local status="succeeded"
    if [ "$exit_code" -ne 0 ]; then
      status="failed"
    fi
    local finished_at
    finished_at="$(discord_autopilot_now)"

    discord_autopilot_write_manifest \
      "${session_dir}/session.json" \
      "$session_id" \
      "uv ${command_string}" \
      "$PWD" \
      "$(hostname)" \
      "$competition" \
      "$instruction" \
      "$artifact_root" \
      "$log_path" \
      "$started_at" \
      "$finished_at" \
      "$status" \
      "$exit_code" \
      "$finished_at"

    return "$exit_code"
  fi

  command "$DISCORD_AUTOPILOT_REAL_UV" "$@"
}
