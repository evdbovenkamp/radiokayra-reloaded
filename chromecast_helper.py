#!/usr/bin/env python3
"""Chromecast control helper for Radio Kayra Reloaded.

Talks to the GNOME Shell extension over stdin/stdout, one JSON object per
line in each direction. Kept deliberately single-threaded on the command
side (the extension waits for a command's result before sending the next
one) — pychromecast's discovery/connect calls are blocking, and that's
fine here since there's never more than one in flight. Status updates
from an active cast arrive from pychromecast's own background socket
thread and are only ever used to emit a JSON line, which is safe to do
from any thread.

Commands in  (stdin):  {"cmd": "discover"}
                       {"cmd": "cast", "uuid": ..., "url": ..., "content_type": ..., "title": ...}
                       {"cmd": "stop"}
                       {"cmd": "volume", "level": 0.0-1.0}
                       {"cmd": "quit"}
Events out (stdout):   {"event": "ready"}
                       {"event": "device", "uuid": ..., "name": ..., "model": ...}
                       {"event": "discover_done"}
                       {"event": "cast_started", "device": ...}
                       {"event": "cast_error", "message": ...}
                       {"event": "media_status", "state": "PLAYING"|"PAUSED"|"IDLE"|"UNKNOWN", "title": ...}
                       {"event": "stopped"}
                       {"event": "error", "message": ...}
"""
import sys
import json
import threading

try:
    import pychromecast
    import zeroconf as zeroconf_module
except ImportError:
    print(json.dumps({"event": "fatal", "error": "pychromecast_missing"}), flush=True)
    sys.exit(1)

_discovered = {}  # uuid -> CastInfo (not yet connected — see discover())
_current = None
_zconf = None  # shared zeroconf instance, reused so connecting a chosen
               # device doesn't need its own fresh mDNS warm-up
_browser = None  # kept running for the life of this process — CastBrowser.
                 # stop_discovery() closes the whole Zeroconf instance, not
                 # just the browser (confirmed live: calling it broke both
                 # the next discover() and the connect in cast() with
                 # "Zeroconf instance loop must be running" / "The event
                 # loop is not running"). So it's just never stopped until
                 # this process exits.
#pychromecast's own `timeout=` arguments have been observed (on a
#link-local-only interface, no real LAN) to not reliably bound how long a
#blocking call takes — a hang in discover()/cast() must never be able to
#wedge this process, since the extension is waiting on a reply to show the
#user something. Every blocking pychromecast call therefore runs in its own
#thread with a hard watchdog on top of it.
_discover_generation = 0
_discover_done_emitted = False


def emit(obj):
    print(json.dumps(obj), flush=True)


class _StatusListener:
    def new_media_status(self, status):
        if status.player_is_playing:
            state = "PLAYING"
        elif status.player_is_paused:
            state = "PAUSED"
        elif status.player_is_idle:
            state = "IDLE"
        else:
            state = "UNKNOWN"
        emit({"event": "media_status", "state": state, "title": status.title})


def _ensure_browser():
    global _browser, _zconf
    if _browser is not None:
        return
    _zconf = zeroconf_module.Zeroconf()
    _browser = pychromecast.discovery.CastBrowser(
        pychromecast.discovery.SimpleCastListener(), _zconf)
    _browser.start_discovery()


#Pure mDNS discovery — lists what's on the network without connecting to
#any of it. pychromecast.get_chromecasts() (the old approach here) instead
#connects to *every* discovered device just to list them, which is the
#slow part: tested live, it took a full 10s+ for two real devices and
#tripped the watchdog below before finishing, so discovery reported zero
#devices even though both were there. Connecting only happens later, in
#cast(), for the one device actually chosen.
def discover():
    global _discover_generation, _discover_done_emitted
    _discover_generation += 1
    gen = _discover_generation
    _discover_done_emitted = False

    def finish_once():
        global _discover_done_emitted
        if gen == _discover_generation and not _discover_done_emitted:
            _discover_done_emitted = True
            emit({"event": "discover_done"})

    def run():
        try:
            _ensure_browser()
            threading.Event().wait(8)  # let mDNS responses accumulate/refresh
            if gen != _discover_generation:
                return
            for uuid, info in _browser.devices.items():
                _discovered[str(uuid)] = info
                emit({"event": "device", "uuid": str(uuid), "name": info.friendly_name, "model": info.model_name})
        except Exception as e:
            if gen == _discover_generation:
                emit({"event": "error", "message": str(e)})
        finish_once()

    def watchdog():
        threading.Event().wait(15)
        finish_once()

    threading.Thread(target=run, daemon=True).start()
    threading.Thread(target=watchdog, daemon=True).start()


def cast(uuid, url, content_type, title):
    global _current
    cast_info = _discovered.get(uuid)
    if not cast_info:
        emit({"event": "cast_error", "message": "device_not_found"})
        return

    done = threading.Event()

    def run():
        global _current
        try:
            cc = pychromecast.get_chromecast_from_cast_info(cast_info, _zconf)
            cc.wait(timeout=10)
            mc = cc.media_controller
            mc.register_status_listener(_StatusListener())
            mc.play_media(url, content_type, title=title, stream_type="LIVE")
            mc.block_until_active(timeout=10)
            _current = cc
            if not done.is_set():
                done.set()
                emit({"event": "cast_started", "device": cc.name})
        except Exception as e:
            if not done.is_set():
                done.set()
                emit({"event": "cast_error", "message": str(e)})

    def watchdog():
        if not done.wait(timeout=20):
            done.set()
            emit({"event": "cast_error", "message": "timeout"})

    threading.Thread(target=run, daemon=True).start()
    threading.Thread(target=watchdog, daemon=True).start()


def stop():
    global _current
    cc, _current = _current, None
    if not cc:
        emit({"event": "stopped"})
        return

    def run():
        try:
            cc.media_controller.stop()
            cc.disconnect()
        except Exception as e:
            emit({"event": "error", "message": str(e)})
            return
        emit({"event": "stopped"})

    threading.Thread(target=run, daemon=True).start()


def set_volume(level):
    try:
        if _current:
            _current.set_volume(level)
    except Exception as e:
        emit({"event": "error", "message": str(e)})


def main():
    emit({"event": "ready"})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        cmd = msg.get("cmd")
        if cmd == "discover":
            discover()
        elif cmd == "cast":
            cast(msg.get("uuid"), msg.get("url"), msg.get("content_type", "audio/mpeg"), msg.get("title", ""))
        elif cmd == "stop":
            stop()
        elif cmd == "volume":
            set_volume(msg.get("level", 1.0))
        elif cmd == "quit":
            break
    try:
        if _current:
            _current.disconnect()
    except Exception:
        pass
    try:
        if _browser:
            _browser.stop_discovery()
    except Exception:
        pass


if __name__ == "__main__":
    main()
