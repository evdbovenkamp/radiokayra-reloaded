import Gio from "gi://Gio";

import * as Utils from "./utils.js";
import * as SearchPageHandler from "./prefssearch.js";
import * as StationsPageHandler from "./prefsstationspage.js";
import * as SettingsPageHandler from "./prefssettingsspage.js";
import * as AboutPageHandler from "./prefsaboutspage.js";
import * as Constants from "./constants.js";

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

    //Remember the window size the user last resized it to.
    let settings = this.getSettings();
    settings.bind(Constants.SCHEMA_PREFS_WINDOW_WIDTH, window, "default-width", Gio.SettingsBindFlags.DEFAULT);
    settings.bind(Constants.SCHEMA_PREFS_WINDOW_HEIGHT, window, "default-height", Gio.SettingsBindFlags.DEFAULT);

    //Stations
    this._stationsPageHandler = new StationsPageHandler.StationsPageHandler(this);
    this._stationsPageHandler.createPage();

    //Search (radio + podcasts)
    this._searchPageHandler = new SearchPageHandler.SearchPageHandler(this);
    this._searchPageHandler.createPage();

    //Settings
    this._settingsPageHandler = new SettingsPageHandler.SettingsPageHandler(this);
    this._settingsPageHandler.createPage();

    //About
    this._aboutPageHandler = new AboutPageHandler.AboutPageHandler(this);
    this._aboutPageHandler.createPage();

    window.connect("close-request", () => {
      if (this._channelsChanged) {
        let val = Utils.uuidv4();
        this.getSettings().set_string(Constants.SCHEMA_CHANNELS_CHANGE_EVENT, Utils.uuidv4(val));
      }

      this._searchPageHandler.clear();
      this._stationsPageHandler.clear();
      this._settingsPageHandler.clear();

      this._searchPageHandler = null;
      this._stationsPageHandler = null;
      this._settingsPageHandler = null;
    });
  }
}
