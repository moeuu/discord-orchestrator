#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
BOT_DIR="$ROOT_DIR/apps/bot"
RUNTIME_DIR="$ROOT_DIR/data/runtime"
LOG_DIR="$ROOT_DIR/logs"
PID_FILE="$RUNTIME_DIR/bot.pid"
LOG_FILE="$LOG_DIR/bot-runtime.log"
BOT_DIST="$BOT_DIR/dist/index.js"

ensure_dirs() {
  mkdir -p "$RUNTIME_DIR" "$LOG_DIR"
}

read_pid() {
  if [ -f "$PID_FILE" ]; then
    cat "$PID_FILE"
  fi
}

find_running_pid() {
  pgrep -f "node $BOT_DIST" | head -n 1 || true
}

find_running_pids() {
  pgrep -f "node $BOT_DIST" || true
}

is_running() {
  pid=$(read_pid || true)

  if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
    return 0
  fi

  actual_pid=$(find_running_pid)
  if [ -n "${actual_pid:-}" ] && kill -0 "$actual_pid" 2>/dev/null; then
    echo "$actual_pid" >"$PID_FILE"
    return 0
  fi

  rm -f "$PID_FILE"
  return 1
}

start_bot() {
  ensure_dirs

  if is_running; then
    echo "Bot is already running (pid $(read_pid))."
    echo "Log: $LOG_FILE"
    return 0
  fi

  (
    cd "$BOT_DIR"
    npm run build >>"$LOG_FILE" 2>&1
    nohup node "$BOT_DIST" >>"$LOG_FILE" 2>&1 &
    echo "$!" >"$PID_FILE"
  )

  sleep 1

  if is_running; then
    echo "Bot started (pid $(read_pid))."
    echo "Log: $LOG_FILE"
    return 0
  fi

  echo "Bot failed to start. Check $LOG_FILE" >&2
  exit 1
}

stop_bot() {
  if ! is_running; then
    echo "Bot is not running."
    return 0
  fi

  pids=$(find_running_pids)

  for pid in $pids; do
    kill "$pid" 2>/dev/null || true
  done

  count=0
  while true; do
    remaining=$(find_running_pids)
    if [ -z "${remaining:-}" ]; then
      break
    fi

    count=$((count + 1))
    if [ "$count" -ge 10 ]; then
      echo "Bot did not stop gracefully; sending SIGKILL."
      for pid in $remaining; do
        kill -9 "$pid" 2>/dev/null || true
      done
      break
    fi
    sleep 1
  done

  rm -f "$PID_FILE"
  echo "Bot stopped."
}

status_bot() {
  if is_running; then
    echo "Bot is running (pid $(read_pid))."
  else
    echo "Bot is stopped."
  fi

  echo "Log: $LOG_FILE"
}

register_commands() {
  cd "$BOT_DIR"
  npm run register
}

show_logs() {
  ensure_dirs

  if [ ! -f "$LOG_FILE" ]; then
    echo "No log file yet: $LOG_FILE"
    return 0
  fi

  tail -n 80 -f "$LOG_FILE"
}

print_help() {
  cat <<EOF
Usage: ./scripts/botctl.sh <command>

Commands:
  start     Start the Discord bot in the background
  stop      Stop the running bot
  restart   Restart the bot
  status    Show whether the bot is running
  logs      Tail the bot runtime log
  register  Register slash commands
  reload    Register slash commands, then restart the bot
EOF
}

command=${1:-help}

case "$command" in
  start)
    start_bot
    ;;
  stop)
    stop_bot
    ;;
  restart)
    stop_bot
    start_bot
    ;;
  status)
    status_bot
    ;;
  logs)
    show_logs
    ;;
  register)
    register_commands
    ;;
  reload)
    register_commands
    stop_bot
    start_bot
    ;;
  help|-h|--help)
    print_help
    ;;
  *)
    print_help >&2
    exit 1
    ;;
esac
