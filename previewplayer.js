import Gst from "gi://Gst";
import GLib from "gi://GLib";
import * as Constants from "./constants.js";

//A short-lived preview player for the station search screen — hear a
//candidate station before adding it, without needing the full panel
//player (prefs runs in its own GTK process, separate from the panel).
//Deliberately minimal: no tags, no seeking, just play/stop, with a hard
//auto-stop so a forgotten preview can never keep playing in the
//background indefinitely. Loaded dynamically by prefssearch.js only if
//GStreamer is actually available (same defensive pattern as the panel's
//own player) — see isAvailable() there.

let initialized = false;
let pipeline = null;
let stopTimeoutId = 0;
let currentUrl = null;
let onStopped = null;

function ensureInit() {
    if (initialized) return;
    Gst.init(null);
    pipeline = Gst.ElementFactory.make("playbin3", "preview");
    const bus = pipeline.get_bus();
    bus.add_signal_watch();
    bus.connect("message", (_bus, message) => {
        if (message.type & (Gst.MessageType.ERROR | Gst.MessageType.EOS)) stop();
    });
    initialized = true;
}

function clearStopTimeout() {
    if (stopTimeoutId !== 0) {
        GLib.Source.remove(stopTimeoutId);
        stopTimeoutId = 0;
    }
}

//callback() — called once playback actually stops, for any reason
//(error, end of stream, the 20s cap, or an explicit stop()/play() of
//something else). Only one preview plays at a time; starting a new one
//stops whatever was previewing before.
export function play(url, callback) {
    ensureInit();
    stop();
    currentUrl = url;
    onStopped = callback ?? null;
    pipeline.set_property("uri", url);
    pipeline.set_state(Gst.State.PLAYING);
    stopTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, Constants.PREVIEW_MAX_SECONDS, () => {
        stopTimeoutId = 0;
        stop();
        return GLib.SOURCE_REMOVE;
    });
}

export function stop() {
    clearStopTimeout();
    if (pipeline) pipeline.set_state(Gst.State.NULL);
    currentUrl = null;
    if (onStopped) { let cb = onStopped; onStopped = null; cb(); }
}

export function isPlayingUrl(url) {
    return currentUrl === url;
}
