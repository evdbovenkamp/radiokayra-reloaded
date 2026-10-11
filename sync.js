import Gio from "gi://Gio";
import GLib from "gi://GLib";
import * as Channels from "./channels.js";
import * as Constants from "./constants.js";

//Syncs channels.json + a handful of device-agnostic settings through a
//folder the user points at (a local path, or an already-mounted WebDAV/cloud
//location under e.g. /run/user/<uid>/gvfs/...). Prefs-only: the panel never
//touches this, to keep any network I/O off the gnome-shell main loop.
//
//"Newest wins": whichever side (local channels.json mtime vs. the remote
//bundle's mtime) changed more recently since the last successful sync wins,
//no merge, no prompt (the user explicitly chose this trade-off). The one
//non-negotiable safety net: every Pull backs up the current local
//channels.json first, since overwriting it is the one truly destructive step.

export const Status = {
    NOT_CONFIGURED: "not_configured",
    NO_OP: "no_op",
    PUSHED: "pushed",
    PULLED: "pulled",
    ERROR: "error",
};

export const SyncManager = class SyncManager {
    constructor(extensionPath, settings) {
        this._extensionPath = extensionPath;
        this._settings = settings;
        this._channelsReadWrite = new Channels.ChannelsReadWrite(extensionPath);
    }

    getSyncFolder() {
        let path = this._settings.get_string(Constants.SCHEMA_SYNC_FOLDER);
        return path ? path : null;
    }
    setSyncFolder(path) {
        this._settings.set_string(Constants.SCHEMA_SYNC_FOLDER, path ?? "");
    }
    isConfigured() {
        return !!this.getSyncFolder();
    }
    getLastSyncedAt() {
        return this._settings.get_string(Constants.SCHEMA_SYNC_LAST_AT);
    }

    _bundleFile() {
        let folder = this.getSyncFolder();
        if (!folder) return null;
        return Gio.File.new_for_path(folder).get_child(Constants.SYNC_BUNDLE_FILENAME);
    }
    _localChannelsFile() {
        return Gio.File.new_for_path(this._channelsReadWrite.channelsFilePath);
    }

    //Reads a file's modification time (seconds), or null if it doesn't exist.
    _mtimeOf(file, callback) {
        file.query_info_async("time::modified", Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, (source, result) => {
            try {
                const info = source.query_info_finish(result);
                callback(info.get_modification_date_time().to_unix());
            } catch (e) { callback(null); } //doesn't exist, or unreadable
        });
    }

    //Checks both sides and pushes or pulls whichever changed more recently
    //since the last sync; does nothing if neither changed. callback(status, error).
    checkAndSync(callback) {
        if (!this.isConfigured()) { callback(Status.NOT_CONFIGURED, null); return; }

        let bundleFile = this._bundleFile();
        let localFile = this._localChannelsFile();

        this._mtimeOf(bundleFile, (remoteMtime) => {
            this._mtimeOf(localFile, (localMtime) => {
                if (remoteMtime === null) { this.push(callback); return; } //nothing out there yet; bootstrap it

                let lastRemote = this._settings.get_int64(Constants.SCHEMA_SYNC_LAST_REMOTE_MTIME);
                let lastLocal = this._settings.get_int64(Constants.SCHEMA_SYNC_LAST_LOCAL_MTIME);

                //This machine has never completed a sync before (both trackers at their
                //default of 0): a brand-new/untouched local channels.json's own mtime is
                //just "when that file was created", not a meaningful edit, and comparing
                //it against the remote's real mtime could wrongly look "newer" and push
                //an empty list over an existing synced library. Always prefer the
                //already-synced remote in that specific case.
                if (lastRemote === 0 && lastLocal === 0) { this.pull(callback); return; }

                let remoteChanged = remoteMtime > lastRemote;
                let localChanged = localMtime !== null && localMtime > lastLocal;

                if (remoteChanged && localChanged) {
                    if (remoteMtime >= localMtime) this.pull(callback);
                    else this.push(callback);
                } else if (remoteChanged) this.pull(callback);
                else if (localChanged) this.push(callback);
                else callback(Status.NO_OP, null);
            });
        });
    }

    //Writes the current local state to the sync folder.
    push(callback) {
        let bundleFile = this._bundleFile();
        if (!bundleFile) { callback(Status.NOT_CONFIGURED, null); return; }

        let channels = this._channelsReadWrite.getChannels();
        let settings = {};
        for (const key of Constants.SYNCED_SETTINGS_KEYS) {
            let variant = this._settings.get_value(key);
            settings[key] = variant.recursiveUnpack();
        }

        let bundle = {
            schemaVersion: Constants.SYNC_BUNDLE_SCHEMA_VERSION,
            exportedAt: new Date().toISOString(),
            hostname: GLib.get_host_name(),
            channels: channels,
            settings: settings,
        };

        let bytes = new TextEncoder().encode(JSON.stringify(bundle, null, "\t"));
        try {
            let parent = bundleFile.get_parent();
            if (parent && !parent.query_exists(null)) parent.make_directory_with_parents(null);
        } catch (e) { /* folder may already exist, or be a mounted location that manages itself */ }

        bundleFile.replace_contents_bytes_async(
            new GLib.Bytes(bytes), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null,
            (source, result) => {
                try {
                    source.replace_contents_finish(result);
                    this._afterSync(Status.PUSHED, callback);
                } catch (e) { callback(Status.ERROR, `${e}`); }
            }
        );
    }

    //Reads the sync folder's bundle and applies it locally. Backs up the
    //current local channels.json first — the one irreversible step here.
    pull(callback) {
        let bundleFile = this._bundleFile();
        if (!bundleFile) { callback(Status.NOT_CONFIGURED, null); return; }

        bundleFile.load_contents_async(null, (source, result) => {
            let bundle;
            try {
                const [, contents] = source.load_contents_finish(result);
                bundle = JSON.parse(new TextDecoder("utf-8").decode(contents));
            } catch (e) { callback(Status.ERROR, `${e}`); return; }

            if (!Array.isArray(bundle.channels)) { callback(Status.ERROR, "Invalid sync bundle (no channels array)."); return; }

            this._backupLocalChannels(() => {
                this._channelsReadWrite.writeChannelsFile(bundle.channels);
                this._applySettings(bundle.settings ?? {});
                this._settings.set_string(Constants.SCHEMA_CHANNELS_CHANGE_EVENT, GLib.uuid_string_random());
                this._afterSync(Status.PULLED, callback);
            });
        });
    }

    //All synced settings are booleans except panelheight (an int); set each
    //with its matching typed GSettings setter.
    _applySettings(settings) {
        for (const key of Constants.SYNCED_SETTINGS_KEYS) {
            if (!(key in settings)) continue;
            try {
                if (typeof settings[key] === "boolean") this._settings.set_boolean(key, settings[key]);
                else if (typeof settings[key] === "number") this._settings.set_int(key, settings[key]);
            } catch (e) { /* skip a setting we can't apply */ }
        }
    }

    _backupLocalChannels(onDone) {
        let localFile = this._localChannelsFile();
        if (!localFile.query_exists(null)) { onDone(); return; }
        let backupFile = Gio.File.new_for_path(this._channelsReadWrite.channelsFilePath + ".bak");
        localFile.copy_async(backupFile, Gio.FileCopyFlags.OVERWRITE, GLib.PRIORITY_DEFAULT, null, null, (source, result) => {
            try { source.copy_finish(result); } catch (e) { /* non-fatal; proceed anyway */ }
            onDone();
        });
    }

    _afterSync(status, callback) {
        let bundleFile = this._bundleFile();
        let localFile = this._localChannelsFile();
        this._mtimeOf(bundleFile, (remoteMtime) => {
            this._mtimeOf(localFile, (localMtime) => {
                if (remoteMtime !== null) this._settings.set_int64(Constants.SCHEMA_SYNC_LAST_REMOTE_MTIME, remoteMtime);
                if (localMtime !== null) this._settings.set_int64(Constants.SCHEMA_SYNC_LAST_LOCAL_MTIME, localMtime);
                this._settings.set_string(Constants.SCHEMA_SYNC_LAST_AT, new Date().toISOString());
                callback(status, null);
            });
        });
    }
}
