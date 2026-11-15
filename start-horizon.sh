#!/bin/bash
# Start Horizon (local DJSet player) and open it in the browser.
# Safe to launch from Finder / Dock (restricted PATH).

ROOT="/Users/nicolasmarchand/Documents/Videos/DJSet"
PORT="${HORIZON_PORT:-8766}"
URL="http://127.0.0.1:${PORT}/"
LOG="${ROOT}/private/horizon-server.log"
PIDFILE="${ROOT}/private/horizon-server.pid"

mkdir -p "${ROOT}/private"

# Finder apps get a tiny PATH — prefer Homebrew, then system.
if [[ -x /opt/homebrew/bin/python3 ]]; then
  PY=/opt/homebrew/bin/python3
elif [[ -x /usr/local/bin/python3 ]]; then
  PY=/usr/local/bin/python3
elif [[ -x /usr/bin/python3 ]]; then
  PY=/usr/bin/python3
else
  /usr/bin/osascript -e 'display alert "Horizon" message "python3 introuvable. Installe Python (Homebrew) puis réessaie." as critical'
  exit 1
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

is_up() {
  /usr/bin/curl -sf -o /dev/null --connect-timeout 1 "${URL}" >/dev/null 2>&1
}

if ! is_up; then
  rm -f "${PIDFILE}"
  # Free a stuck listener if any.
  for pid in $(/usr/sbin/lsof -tiTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null); do
    /bin/kill "$pid" 2>/dev/null || true
  done
  /bin/sleep 0.3

  cd "${ROOT}" || exit 1
  /usr/bin/nohup "$PY" "${ROOT}/serve.py" >>"${LOG}" 2>&1 &
  echo $! >"${PIDFILE}"

  ok=0
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
    if is_up; then ok=1; break; fi
    /bin/sleep 0.4
  done

  if [[ "$ok" -ne 1 ]]; then
    /usr/bin/osascript -e 'display alert "Horizon" message "Le serveur local n’a pas démarré. Voir private/horizon-server.log" as critical'
    exit 1
  fi
fi

/usr/bin/open "${URL}"
exit 0
