#!/usr/bin/env bash
# Installs Radio Kayra Reloaded for the current user.
#
# Links this repo directory into GNOME Shell's extensions folder (so a
# `git pull` later picks up updates without reinstalling), compiles the
# settings schema, and checks for the optional GStreamer/pychromecast
# dependencies.
set -euo pipefail

UUID="radiokayra-reloaded@europetrader.gmail.com"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo "Installing Radio Kayra Reloaded from $REPO_DIR"

if [ -L "$EXT_DIR" ] && [ "$(readlink -f "$EXT_DIR")" = "$REPO_DIR" ]; then
    echo "Already linked to this repo, skipping link step."
elif [ -e "$EXT_DIR" ] || [ -L "$EXT_DIR" ]; then
    echo "Something already exists at $EXT_DIR"
    read -r -p "Remove it and replace with a link to this repo? [y/N] " answer
    if [[ "$answer" =~ ^[Yy]$ ]]; then
        rm -rf "$EXT_DIR"
        ln -s "$REPO_DIR" "$EXT_DIR"
        echo "Linked $REPO_DIR -> $EXT_DIR"
    else
        echo "Leaving $EXT_DIR untouched. Installation aborted."
        exit 1
    fi
else
    mkdir -p "$(dirname "$EXT_DIR")"
    ln -s "$REPO_DIR" "$EXT_DIR"
    echo "Linked $REPO_DIR -> $EXT_DIR"
fi

echo "Compiling settings schema..."
glib-compile-schemas "$EXT_DIR/schemas/"

echo
echo "Checking optional dependencies..."

if ! command -v gst-launch-1.0 >/dev/null 2>&1; then
    echo
    echo "WARNING: GStreamer not found. Playback will not work without it."
    echo "  On Ubuntu/Debian:"
    echo "    sudo apt install gstreamer1.0-tools gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly gstreamer1.0-libav"
else
    echo "  GStreamer: found"
fi

if ! python3 -c "import pychromecast" >/dev/null 2>&1; then
    echo "  python3-pychromecast: not found (only needed for casting to a Chromecast/Google TV)"
    echo "    sudo apt install python3-pychromecast"
else
    echo "  python3-pychromecast: found"
fi

echo
echo "Done. Next steps:"
echo "  1. Log out and log back in — GNOME Shell only loads newly-installed"
echo "     extensions on login, not on enable/disable."
echo "  2. Enable it:"
echo "       gnome-extensions enable $UUID"
echo "     (or use the Extensions app / GNOME Tweaks)"
echo "  3. Optional: add a free PodcastIndex.org API key in the extension's"
echo "     Settings page to search podcasts (https://api.podcastindex.org/signup)."
