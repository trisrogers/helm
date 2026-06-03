#!/usr/bin/env bash
# Install (or refresh) the OpenClaw voice sidecar systemd --user unit from the
# canonical copy in this repo, then enable + start it. Idempotent: safe to re-run
# after editing the unit file.
set -euo pipefail

UNIT=openclaw-voice-sidecar.service
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$UNIT"
DEST_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
DEST="$DEST_DIR/$UNIT"
SIDECAR_DIR=/home/tris/projects/openclaw-voice-sidecar

# Sanity: the sidecar repo + venv the unit points at must actually exist.
if [[ ! -x "$SIDECAR_DIR/.venv/bin/python" ]]; then
  echo "✗ sidecar venv not found at $SIDECAR_DIR/.venv — run 'uv sync' in that repo first." >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
install -m 0644 "$SRC" "$DEST"
echo "✓ installed $UNIT → $DEST"

systemctl --user daemon-reload

# If a manual instance is already holding :18790, stop it so systemd can own the
# port — otherwise the unit's first start would fail with EADDRINUSE.
if ss -ltn 2>/dev/null | grep -q '127.0.0.1:18790'; then
  if ! systemctl --user is-active --quiet "$UNIT"; then
    echo "… :18790 is held by a non-systemd process; stop it before enabling, or this start may fail."
  fi
fi

systemctl --user enable --now "$UNIT"
echo "✓ enabled + started $UNIT"
systemctl --user --no-pager --lines=0 status "$UNIT" || true

# Survive logout/reboot without an active login session.
if ! loginctl show-user "$USER" 2>/dev/null | grep -q 'Linger=yes'; then
  echo "ℹ enable lingering so the sidecar runs without an active login:"
  echo "    sudo loginctl enable-linger $USER"
fi
