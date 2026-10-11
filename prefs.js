import Gio from "gi://Gio";

import * as Utils from "./utils.js";
import * as Sync from "./sync.js";
import * as Constants from "./constants.js";
import * as SearchPageHandler from "./prefssearch.js";
import * as StationsPageHandler from "./prefsstationspage.js";
import * as SettingsPageHandler from "./prefssettingsspage.js";
import * as AboutPageHandler from "./prefsaboutspage.js";

import { ExtensionPreferences, gettext as _, } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

//glib-compile-schemas schemas/
export default class RadioKayraPreferences extends ExtensionPreferences {
  constructor(metadata) {
    super(metadata);
    console.info(`constructing ${this.metadata.name}`);
  }
  fillPreferencesWindow(window) {
    this._window = window;
    this._channelsChanged = false;
    //True once the opening checkAndSync has resolved. Closing before that
    //must never push: a push could race the still-in-flight pull and
    //overwrite the sync folder with stale/incomplete local data.
    this._openingSyncDone = false;

    let settings = this.getSettings();

    //Remember the window size the user last resized it to.
    settings.bind(Constants.SCHEMA_PREFS_WINDOW_WIDTH, window, "default-width", Gio.SettingsBindFlags.DEFAULT);
    settings.bind(Constants.SCHEMA_PREFS_WINDOW_HEIGHT, window, "default-height", Gio.SettingsBindFlags.DEFAULT);

    this._syncManager = new Sync.SyncManager(this.path, settings);

    //Any synced setting toggled this session also counts as "changed",
    //same as editing the station list, so it gets pushed out on close.
    this._syncedSettingHandlers = Constants.SYNCED_SETTINGS_KEYS.map(key =>
      settings.connect(`changed::${key}`, () => { this._channelsChanged = true; })
    );

    //Search (radio + podcasts)
    this._searchPageHandler = new SearchPageHandler.SearchPageHandler(this);
    this._searchPageHandler.createPage();

    //Settings (also owns the sync folder UI)
    this._settingsPageHandler = new SettingsPageHandler.SettingsPageHandler(this);
    this._settingsPageHandler.createPage();

    //About
    this._aboutPageHandler = new AboutPageHandler.AboutPageHandler(this);
    this._aboutPageHandler.createPage();

    //Stations: wait for the opening sync check (pull if the remote changed)
    //so the list shown is current. Resolves immediately if sync isn't set up.
    this._syncManager.checkAndSync((status, error) => {
      if (status === Sync.Status.ERROR) console.warn(`${Constants.LOG_PREFIX_PREPS} Sync check failed: [${error}]`);
      this._openingSyncDone = true;
      this._stationsPageHandler = new StationsPageHandler.StationsPageHandler(this);
      this._stationsPageHandler.createPage();
    });

    window.connect("close-request", () => {
      if (this._channelsChanged) {
        let val = Utils.uuidv4();
        this.getSettings().set_string(Constants.SCHEMA_CHANNELS_CHANGE_EVENT, Utils.uuidv4(val));

        //Only push if something actually changed AND the opening sync (which
        //may still be pulling) has finished — never race a pull with a push.
        if (this._openingSyncDone) {
          this._syncManager.push((status, error) => {
            if (status === Sync.Status.ERROR) console.warn(`${Constants.LOG_PREFIX_PREPS} Sync push failed: [${error}]`);
          });
        }
      }

      this._syncedSettingHandlers.forEach(id => settings.disconnect(id));

      this._searchPageHandler.clear();
      this._stationsPageHandler?.clear();
      this._settingsPageHandler.clear();

      this._searchPageHandler = null;
      this._stationsPageHandler = null;
      this._settingsPageHandler = null;
      this._syncManager = null;
    });
  }
}
