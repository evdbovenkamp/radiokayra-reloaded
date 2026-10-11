import Gio from "gi://Gio";
import GLib from "gi://GLib";
import * as Utils from "./utils.js";
import * as Constants from "./constants.js";

//Playback positions for podcast episodes, kept out of channels.json/the sync
//channels bundle entirely: a position is a per-episode scalar, not part of
//the station list, and gets written far more often (every 30s while
//playing) than anything in sync.js should be.
//
//Shape: { "<channelId>": { guid, position, updatedAt } }. Keyed by episode
//guid *inside* each entry, not just by channel id, because a "feed" channel
//plays a different episode over time; resuming into the wrong episode would
//be worse than not resuming at all.
//
//The sync copy can have entries from other machines for *other* channels
//(or even a newer entry for the same channel, if played there more
//recently), so every write to it merges key-by-key rather than overwriting
//the whole file — each key independently keeps whichever side's updatedAt
//is newer. Same "newest wins, no merge-UI" trade-off as sync.js, just
//scoped to one scalar per channel instead of a whole list.

const FILENAME = "positions.json";

function getLocalFile() {
    return Gio.File.new_for_path(`${Utils.getConfigPath()}/${FILENAME}`);
}
function getSyncFile(syncFolder) {
    return syncFolder ? Gio.File.new_for_path(syncFolder).get_child(FILENAME) : null;
}

function readFile(file, callback) {
    if (!file) { callback({}); return; }
    file.load_contents_async(null, (source, result) => {
        try {
            const [, contents] = source.load_contents_finish(result);
            callback(JSON.parse(new TextDecoder("utf-8").decode(contents)));
        } catch (e) { callback({}); } //doesn't exist yet, or unreadable: start fresh
    });
}
function writeFile(file, data, callback) {
    if (!file) { callback?.(); return; }
    const bytes = new TextEncoder().encode(JSON.stringify(data, null, "\t"));
    file.replace_contents_bytes_async(new GLib.Bytes(bytes), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null, (source, result) => {
        try { source.replace_contents_finish(result); } catch (e) { console.warn(`${Constants.LOG_PREFIX_EXTENSION} Failed to write ${FILENAME}: [${e}]`); }
        callback?.();
    });
}
//Combines two {channelId: {guid, position, updatedAt}} maps, keeping
//whichever side's entry is newer for each key independently.
function mergeNewest(a, b) {
    let merged = { ...a };
    for (const [key, entry] of Object.entries(b)) {
        if (!merged[key] || new Date(entry.updatedAt) > new Date(merged[key].updatedAt)) merged[key] = entry;
    }
    return merged;
}

//Returns {guid, position, updatedAt} for this channel, preferring whichever
//of the local/sync copies is newer, or null if there's nothing saved yet.
export function getPosition(channelId, syncFolder, callback) {
    readFile(getLocalFile(), (local) => {
        readFile(getSyncFile(syncFolder), (sync) => {
            callback(mergeNewest(local, sync)[channelId] ?? null);
        });
    });
}

export function savePosition(channelId, guid, positionSeconds, syncFolder) {
    const entry = { guid, position: positionSeconds, updatedAt: new Date().toISOString() };

    const localFile = getLocalFile();
    readFile(localFile, (local) => {
        local[channelId] = entry;
        writeFile(localFile, local);
    });

    const syncFile = getSyncFile(syncFolder);
    if (!syncFile) return;
    readFile(syncFile, (sync) => {
        sync[channelId] = entry;
        writeFile(syncFile, sync);
    });
}

export function clearPosition(channelId, syncFolder) {
    const localFile = getLocalFile();
    readFile(localFile, (local) => {
        delete local[channelId];
        writeFile(localFile, local);
    });

    const syncFile = getSyncFile(syncFolder);
    if (!syncFile) return;
    readFile(syncFile, (sync) => {
        delete sync[channelId];
        writeFile(syncFile, sync);
    });
}
