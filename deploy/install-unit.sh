#!/usr/bin/env bash
# Install (or refresh) a systemd --user unit from the canonical copy in this
# repo's deploy/ dir, then enable + start it. Idempotent: safe to re-run after
# editing the unit file.
#
#   deploy/install-unit.sh <unit-file-name>
#       e.g. deploy/install-unit.sh helm.service
set -euo pipefail

UNIT="${1:?usage: install-unit.sh <unit-file-name>}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$UNIT"
DEST_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
DEST="$DEST_DIR/$UNIT"

[[ -f "$SRC" ]] || { echo "✗ no such unit in deploy/: $UNIT" >&2; exit 1; }

mkdir -p "$DEST_DIR"
install -m 0644 "$SRC" "$DEST"
echo "✓ installed $UNIT → $DEST"

systemctl --user daemon-reload
systemctl --user enable --now "$UNIT"
echo "✓ enabled + started $UNIT"
systemctl --user --no-pager --lines=0 status "$UNIT" || true

# systemd --user services stop at logout unless lingering is enabled.
if ! loginctl show-user "$USER" 2>/dev/null | grep -q 'Linger=yes'; then
  echo "ℹ for reboot survival without an active login, run: sudo loginctl enable-linger $USER"
fi
