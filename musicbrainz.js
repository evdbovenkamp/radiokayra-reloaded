import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Soup from "gi://Soup?version=3.0";
import * as Constants from "./constants.js";
import * as Utils from "./utils.js";

//Enriches "now playing" radio tags with cover art via MusicBrainz + Cover
//Art Archive. Toggleable in Settings (default on); a per-track lookup, not
//something podcasts need (they already carry their own artwork).
//
//MusicBrainz's usage policy requires an identifying User-Agent and asks for
//at most ~1 request/second per client — verified live (a generic UA got an
//immediate 503, the real one didn't; a bare retry too soon also 503'd,
//confirming that was rate-limiting rather than a format rejection). Every
//lookup here goes through one shared queue that enforces that spacing,
//however many tracks change in a burst (e.g. right after switching stations).

const session = new Soup.Session({ timeout: 10, user_agent: Constants.MUSICBRAINZ_USER_AGENT });
let cancellable = new Gio.Cancellable();

const cache = new Map(); //"artist\u0000title" -> GLib.Bytes or null (negative cache: 404/no-match only, never on transient errors)
const queue = [];
let queueTimerActive = false;
let queueTimeoutId = 0;

function enqueue(fn) {
    queue.push(fn);
    if (!queueTimerActive) runQueue();
}
function runQueue() {
    const job = queue.shift();
    if (!job) { queueTimerActive = false; return; }
    queueTimerActive = true;
    let done = false;
    const finish = () => {
        if (done) return;
        done = true;
        queueTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Constants.MUSICBRAINZ_MIN_INTERVAL_MS, () => {
            queueTimeoutId = 0;
            runQueue();
            return GLib.SOURCE_REMOVE;
        });
    };
    try {
        job(finish);
    } catch (e) {
        finish();
    }
}

function cacheSet(key, value) {
    if (!cache.has(key) && cache.size >= Constants.COVERART_CACHE_MAX_ENTRIES) {
        cache.delete(cache.keys().next().value);
    }
    cache.set(key, value);
}

function escapeQueryTerm(value) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function httpGetJson(url, callback) {
    const message = Soup.Message.new("GET", url);
    session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable, (source, result) => {
        let status = 0, text = null;
        try {
            const bytes = source.send_and_read_finish(result);
            status = message.get_status();
            text = new TextDecoder("utf-8").decode(bytes.get_data());
        } catch (e) {
            callback(0, null);
            return;
        }
        callback(status, text);
    });
}

//Fetches the cover art image bytes directly (Soup 3 follows the 307
//redirect chain on its own), so the caller never has to fetch it twice.
//status: the final HTTP status after redirects (404 = no art there; 5xx/0 = transient).
function httpGetImage(url, callback) {
    const message = Soup.Message.new("GET", url);
    session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable, (source, result) => {
        let status = 0, bytes = null;
        try {
            bytes = source.send_and_read_finish(result);
            status = message.get_status();
        } catch (e) {
            callback(0, null);
            return;
        }
        if (status !== Soup.Status.OK || !bytes || bytes.get_size() === 0) {
            callback(status, null);
            return;
        }
        callback(status, bytes);
    });
}

function searchRecording(artist, title, callback) {
    const query = encodeURIComponent(`artist:"${escapeQueryTerm(artist)}" AND recording:"${escapeQueryTerm(title)}"`);
    const url = `https://musicbrainz.org/ws/2/recording/?query=${query}&fmt=json&limit=5`;
    httpGetJson(url, (status, text) => {
        if (status !== Soup.Status.OK || !text) { callback(null); return; }
        try {
            const data = JSON.parse(text);
            callback(data.recordings ?? []);
        } catch (e) { callback(null); }
    });
}

//Among a recording's releases, prefer an official "Album" release-group
//with the earliest date — more likely the canonical original than some
//random compilation that happens to include the track.
function pickBestRelease(recording) {
    const releases = recording?.releases ?? [];
    if (releases.length === 0) return null;
    const albums = releases.filter(r => r["release-group"]?.["primary-type"] === "Album");
    const pool = albums.length > 0 ? albums : releases;
    return pool.slice().sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"))[0];
}

//callback(GLib.Bytes|null) — image bytes for the cover art, or null if none
//is available / confidently matched. Never calls back with a transient
//failure cached as "no art" — a retry later in the session can still succeed.
export function lookupCoverArt(artist, title, callback) {
    if (Utils.isEmptyString(artist) || Utils.isEmptyString(title)) { callback(null); return; }
    const key = `${artist}\u0000${title}`;
    if (cache.has(key)) { callback(cache.get(key)); return; }

    enqueue((done) => {
        searchRecording(artist, title, (recordings) => {
            const best = (recordings ?? [])[0];
            if (!best || (best.score ?? 0) < Constants.MUSICBRAINZ_MIN_SCORE) {
                cacheSet(key, null);
                callback(null);
                done();
                return;
            }
            const release = pickBestRelease(best);
            if (!release) {
                cacheSet(key, null);
                callback(null);
                done();
                return;
            }

            const candidates = [];
            if (release["release-group"]?.id) candidates.push(`https://coverartarchive.org/release-group/${release["release-group"].id}/front-250`);
            candidates.push(`https://coverartarchive.org/release/${release.id}/front-250`);

            const tryNext = (index) => {
                if (index >= candidates.length) { cacheSet(key, null); callback(null); done(); return; }
                httpGetImage(candidates[index], (status, bytes) => {
                    if (bytes) { cacheSet(key, bytes); callback(bytes); done(); }
                    else if (status === 404) { tryNext(index + 1); }
                    else { callback(null); done(); } //transient failure — not cached
                });
            };
            tryNext(0);
        });
    });
}

//Drops anything in flight/queued. Called on extension teardown so no
//pending timeout source or network request outlives the panel.
export function reset() {
    queue.length = 0;
    queueTimerActive = false;
    if (queueTimeoutId !== 0) {
        GLib.Source.remove(queueTimeoutId);
        queueTimeoutId = 0;
    }
    cancellable.cancel();
    cancellable = new Gio.Cancellable();
}
