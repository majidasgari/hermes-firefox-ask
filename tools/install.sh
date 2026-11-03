#!/usr/bin/env bash
# Install (or refresh) the local bridge the add-on talks to:
#   copy the script under ~/.local/share, render the systemd user unit, start it.
# Usage: tools/install.sh         (add-on install is separate — see README)
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest="${XDG_DATA_HOME:-$HOME/.local/share}/hermes-firefox-ask"
unit_dir="$HOME/.config/systemd/user"

mkdir -p "$dest/bridge" "$unit_dir"
install -m 0755 "$root/bridge/hermes_ask_bridge.py" "$dest/bridge/hermes_ask_bridge.py"

sed -e "s|__BRIDGE__|$dest/bridge/hermes_ask_bridge.py|" \
    "$root/bridge/hermes-ask-bridge.service" > "$unit_dir/hermes-ask-bridge.service"

systemctl --user daemon-reload
systemctl --user enable hermes-ask-bridge.service
systemctl --user restart hermes-ask-bridge.service
sleep 1
echo "bridge: $(curl -s --max-time 5 "http://127.0.0.1:${HERMES_ASK_PORT:-8790}/health" || echo 'no answer')"
echo "script: $dest/bridge/hermes_ask_bridge.py"
