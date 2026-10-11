import Gio from "gi://Gio";
import GLib from "gi://GLib";
import * as Constants from "./constants.js";

//Casts the current radio stream / podcast episode URL directly to a
//Chromecast or Google TV device — the device fetches the URL itself (same
//as any Cast-compatible receiver app), there's no local re-encoding or
//audio relaying involved.
//
//The actual Chromecast protocol (TLS + CASTV2/protobuf) and mDNS discovery
//are handled by python3-pychromecast, a well-established external library,
//via a small subprocess helper (chromecast_helper.py) rather than
//reimplementing that protocol in GJS. Casting is an optional extra on top
//of the always-working radio/podcast playback — if pychromecast isn't
//installed, isAvailable() reports that and the caller is expected to show
//install instructions rather than silently failing.

let availableCache = null; //null = not checked yet, else true/false
let proc = null;
let stdinStream = null;
let stdoutReader = null;
let readyCallbacks = [];
let isReady = false;

let discoveredDevices = [];
let discoverCallback = null;
let castCallback = null;
let stopCallback = null;
let onStatusChanged = null;

let extensionPath = null;

//Must be called once (kayramenu.js passes extension.path, the same
//convention as channels.js/sync.js/popstreaminfo.js) before any other
//function here that needs to locate chromecast_helper.py.
export function init(path) {
    extensionPath = path;
}

function getHelperPath() {
    return GLib.build_filenamev([extensionPath, "chromecast_helper.py"]);
}

//A lightweight, one-off check — does not start the long-lived helper.
//Cached for the lifetime of the panel; call reset() to force a recheck.
export function isAvailable(callback) {
    if (availableCache !== null) { callback(availableCache); return; }
    try {
        const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE,
        });
        const checkProc = launcher.spawnv(["python3", "-c", "import pychromecast"]);
        checkProc.wait_async(null, (source, result) => {
            try {
                source.wait_finish(result);
                availableCache = source.get_successful();
            } catch (e) {
                availableCache = false;
            }
            callback(availableCache);
        });
    } catch (e) {
        availableCache = false;
        callback(false);
    }
}

function ensureHelperRunning(callback) {
    console.log(`${Constants.LOG_PREFIX_EXTENSION} Chromecast: ensureHelperRunning, isReady=${isReady}, proc=${proc !== null}`);
    if (isReady) { callback(); return; }
    readyCallbacks.push(callback);
    if (proc !== null) return; //already starting

    try {
        const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
        });
        proc = launcher.spawnv(["python3", "-u", getHelperPath()]);
        console.log(`${Constants.LOG_PREFIX_EXTENSION} Chromecast: helper spawned, pid=${proc.get_identifier()}`);
    } catch (e) {
        console.error(`${Constants.LOG_PREFIX_EXTENSION} Chromecast helper failed to start: [${e}]`);
        flushReadyCallbacks();
        return;
    }
    stdinStream = proc.get_stdin_pipe();
    stdoutReader = new Gio.DataInputStream({ base_stream: proc.get_stdout_pipe() });
    readLoop();
}

function flushReadyCallbacks() {
    let callbacks = readyCallbacks;
    readyCallbacks = [];
    callbacks.forEach(cb => cb());
}

function readLoop() {
    if (!stdoutReader) return;
    stdoutReader.read_line_async(GLib.PRIORITY_DEFAULT, null, (source, result) => {
        if (!stdoutReader) return; //reset() tore this down while the read was in flight — a handler invoked synchronously from the previous event can do that
        let line;
        try {
            [line] = source.read_line_finish_utf8(result);
        } catch (e) {
            line = null;
        }
        if (line === null) { console.log(`${Constants.LOG_PREFIX_EXTENSION} Chromecast: helper stdout closed`); onHelperExited(); return; }
        console.log(`${Constants.LOG_PREFIX_EXTENSION} Chromecast: raw line: [${line}]`);
        handleEvent(line);
        readLoop();
    });
}

function onHelperExited() {
    isReady = false;
    proc = null;
    stdinStream = null;
    stdoutReader = null;
    if (castCallback) { let cb = castCallback; castCallback = null; cb(false, "helper_exited"); }
    if (stopCallback) { let cb = stopCallback; stopCallback = null; cb(); }
    if (discoverCallback) { let cb = discoverCallback; discoverCallback = null; cb(discoveredDevices); }
}

function handleEvent(line) {
    let msg;
    try { msg = JSON.parse(line); } catch (e) {
        console.warn(`${Constants.LOG_PREFIX_EXTENSION} Chromecast: unparseable line from helper: [${line}]`);
        return;
    }

    switch (msg.event) {
        case "ready":
            isReady = true;
            flushReadyCallbacks();
            break;
        case "device":
            discoveredDevices.push({ uuid: msg.uuid, name: msg.name, model: msg.model });
            break;
        case "discover_done":
            if (discoverCallback) {
                let cb = discoverCallback;
                discoverCallback = null;
                let devices = discoveredDevices;
                discoveredDevices = [];
                cb(devices);
            }
            break;
        case "cast_started":
            if (castCallback) { let cb = castCallback; castCallback = null; cb(true, null); }
            break;
        case "cast_error":
            if (castCallback) { let cb = castCallback; castCallback = null; cb(false, msg.message); }
            break;
        case "stopped":
            if (stopCallback) { let cb = stopCallback; stopCallback = null; cb(); }
            break;
        case "media_status":
            onStatusChanged?.(msg.state, msg.title);
            break;
        case "error":
            console.warn(`${Constants.LOG_PREFIX_EXTENSION} Chromecast helper error: [${msg.message}]`);
            break;
    }
}

function sendCommand(obj) {
    if (!stdinStream) { console.log(`${Constants.LOG_PREFIX_EXTENSION} Chromecast: sendCommand skipped, no stdinStream`); return; }
    const bytes = new GLib.Bytes(new TextEncoder().encode(JSON.stringify(obj) + "\n"));
    stdinStream.write_bytes_async(bytes, GLib.PRIORITY_DEFAULT, null, (source, result) => {
        try {
            source.write_bytes_finish(result);
            console.log(`${Constants.LOG_PREFIX_EXTENSION} Chromecast: wrote command ${JSON.stringify(obj)}`);
        } catch (e) {
            console.log(`${Constants.LOG_PREFIX_EXTENSION} Chromecast: write failed: [${e}]`);
        }
    });
}

//callback(devices: [{uuid, name, model}])
export function discoverDevices(callback) {
    console.log(`${Constants.LOG_PREFIX_EXTENSION} Chromecast: discoverDevices() called`);
    ensureHelperRunning(() => {
        console.log(`${Constants.LOG_PREFIX_EXTENSION} Chromecast: sending discover command`);
        discoverCallback = callback;
        discoveredDevices = [];
        sendCommand({ cmd: "discover" });
    });
}

//callback(success, errorMessage)
export function castUrl(uuid, url, contentType, title, callback) {
    ensureHelperRunning(() => {
        castCallback = callback;
        sendCommand({ cmd: "cast", uuid, url, content_type: contentType, title });
    });
}

export function stopCasting(callback) {
    if (!isReady) { callback?.(); return; }
    stopCallback = callback ?? (() => {});
    sendCommand({ cmd: "stop" });
}

export function setVolume(level) {
    if (!isReady) return;
    sendCommand({ cmd: "volume", level });
}

export function setOnStatusChanged(callback) {
    onStatusChanged = callback;
}

//Tears the helper process down. Called on extension teardown so no
//subprocess outlives the panel.
export function reset() {
    if (proc) {
        try { sendCommand({ cmd: "quit" }); } catch (e) { /* ignore */ }
        try { proc.force_exit(); } catch (e) { /* ignore */ }
    }
    proc = null;
    stdinStream = null;
    stdoutReader = null;
    isReady = false;
    readyCallbacks = [];
    discoveredDevices = [];
    discoverCallback = null;
    castCallback = null;
    stopCallback = null;
}
