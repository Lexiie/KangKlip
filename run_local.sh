#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT_DIR/.logs"
PID_DIR="$ROOT_DIR/.pids"

mkdir -p "$LOG_DIR" "$PID_DIR"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT_DIR/.env"
  set +a
else
  echo "Missing .env file. Copy .env.example and fill values first." >&2
  exit 1
fi

start_redis() {
  if [[ "${REDIS_URL:-}" == "redis://localhost:6379/0" ]]; then
    if command -v redis-cli >/dev/null 2>&1; then
      if redis-cli ping >/dev/null 2>&1; then
        return 0
      fi
    fi
    echo "Redis not started by script. Please run Redis manually on localhost:6379." >&2
  fi
}

start_backend() {
  echo "Starting backend..."
  (cd "$ROOT_DIR" && PYTHONPATH="$ROOT_DIR" nohup uvicorn backend.main:app --reload --reload-dir "$ROOT_DIR/backend" --host 127.0.0.1 --port 8000 >"$LOG_DIR/backend.log" 2>&1 & echo $! >"$PID_DIR/backend.pid")
}

start_frontend() {
  echo "Starting frontend..."
  (cd "$ROOT_DIR/frontend" && HOSTNAME=localhost NEXT_TELEMETRY_DISABLED=1 nohup npm run dev -- --hostname 127.0.0.1 --port 3000 >"$LOG_DIR/frontend.log" 2>&1 & echo $! >"$PID_DIR/frontend.pid")
}

stop_service() {
  local name="$1"
  local pid_file="$PID_DIR/$name.pid"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file")"
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_file"
    echo "Stopped $name"
  else
    echo "No pid file for $name"
  fi
}

stop_all() {
  stop_service "frontend"
  stop_service "backend"
}

status_all() {
  for name in backend frontend; do
    local pid_file="$PID_DIR/$name.pid"
    if [[ -f "$pid_file" ]]; then
      local pid
      pid="$(cat "$pid_file")"
      if kill -0 "$pid" 2>/dev/null; then
        echo "$name running (pid $pid)"
      else
        echo "$name not running (stale pid $pid)"
      fi
    else
      echo "$name not running"
    fi
  done
}

usage() {
  echo "Usage: $0 {start|stop|restart|status}"
}

case "${1:-start}" in
  start)
    start_redis
    start_backend
    start_frontend
    ;;
  stop)
    stop_all
    ;;
  restart)
    stop_all
    start_redis
    start_backend
    start_frontend
    ;;
  status)
    status_all
    ;;
  *)
    usage
    exit 1
    ;;
esac

echo "Backend: http://localhost:8000"
echo "Frontend: http://localhost:3000"
echo "Logs: $LOG_DIR"
