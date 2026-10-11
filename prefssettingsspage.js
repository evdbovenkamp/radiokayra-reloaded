import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";

import * as Constants from "./constants.js";
import * as PodcastIndex from "./podcastindex.js";
import * as Utils from "./utils.js";
import * as Sync from "./sync.js";
import * as Chromecast from "./chromecast.js";

import { ExtensionPreferences, gettext as _, } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

export const SettingsPageHandler = class SettingsPageHandler {
    constructor(kayraPrefs) {
        this._kayraPrefs = kayraPrefs;
        this._window = kayraPrefs._window; 
        this._schema = this._kayraPrefs.getSettings();     
    }
    clear() { 
        this._settingGroup = null;
        this._settingsPage = null;  
        this._rows = null;
    }
    createPage() {
        this._settingsPage = new Adw.PreferencesPage();
        this._settingsPage.title = _("Settings");        
        this._settingsPage.icon_name = Constants.ICON_SETTINGS;
    
        this._window.add(this._settingsPage);
        this._rows = [];        

        //Settings
        this._settingsGroup = new Adw.PreferencesGroup();
        
        //HOVER
        this._show_hover_tooltip = new Adw.SwitchRow({
            title: _("Show hover tooltip"),
            subtitle: _("Shows the song, artist, station info when you hover on the radio icon")
        });
        this._schema.bind(Constants.SCHEMA_SONG_TOOLTIP, this._show_hover_tooltip, 'active', Gio.SettingsBindFlags.DEFAULT);
        this._settingsGroup.add(this._show_hover_tooltip);
        //HOVER

        //TRACK NOTIFICATION
        this._show_track_notification = new Adw.SwitchRow({
            title: _("Show track notification"),
            subtitle: _("Pops up a desktop notification with the artist and title when a new track starts.")
        });
        this._schema.bind(Constants.SCHEMA_SONG_NOTIFICATION, this._show_track_notification, 'active', Gio.SettingsBindFlags.DEFAULT);
        this._settingsGroup.add(this._show_track_notification);
        //TRACK NOTIFICATION

        //ENRICH TRACK DATA
        this._enrich_track_data = new Adw.SwitchRow({
            title: _("Enrich track data"),
            subtitle: _("Looks up cover art for the current radio track via MusicBrainz and the Cover Art Archive.")
        });
        this._schema.bind(Constants.SCHEMA_ENRICH_TRACK_DATA, this._enrich_track_data, 'active', Gio.SettingsBindFlags.DEFAULT);
        this._settingsGroup.add(this._enrich_track_data);
        //ENRICH TRACK DATA

        //RIGHT CLICK SETTINGS
        this._right_click_settings = new Adw.SwitchRow({
            title: _("Right click - Settings"),
            subtitle: _("Opens the settings(this) window when you right click on the radio icon.")
        });
        this._schema.bind(Constants.SCHEMA_RIGHTCLICK_SETTINGS, this._right_click_settings, 'active', Gio.SettingsBindFlags.DEFAULT);
        this._settingsGroup.add(this._right_click_settings); 
        //RIGHT CLICK SETTINGS

        //RIGHT CLICK COPY SONG
        this._right_click_songtitle = new Adw.SwitchRow({
            title: _("Right click - Copy Song"),
            subtitle: _("Copies the song title to clipboard when you right click on the radio icon.")
        });
        this._schema.bind(Constants.SCHEMA_RIGHTCLICK_COPYSONG, this._right_click_songtitle, 'active', Gio.SettingsBindFlags.DEFAULT);
        this._settingsGroup.add(this._right_click_songtitle); 
        //RIGHT CLICK SETTINGS

        this._panel_height_spin = new Adw.SpinRow({
            title: _("Panel Height"),
            subtitle: _("The height of the extension window when opened."),
            adjustment: new Gtk.Adjustment({
                lower: 100,
                upper: 700,
                step_increment: 5
            })
        });
        //GNOME SEARCH
        this._gnome_search = new Adw.SwitchRow({
            title: _("Gnome Search Support"),
            subtitle: _("Search and play your stations using Gnome search.")
        });
        this._schema.bind(Constants.SCHEMA_GNOME_SEARCH, this._gnome_search, 'active', Gio.SettingsBindFlags.DEFAULT);
        this._settingsGroup.add(this._gnome_search); 
        //GNOME SEARCH

        //this._panel_height_spin.value = 220;
        this._schema.bind(Constants.SCHEMA_PANEL_HEIGHT, this._panel_height_spin, 'value', Gio.SettingsBindFlags.DEFAULT);
        this._settingsGroup.add(this._panel_height_spin);

        this._settingsPage.add(this._settingsGroup);

        this.createSyncGroup();
        this.createPodcastIndexGroup();
        this.createChromecastGroup();
      }
      createSyncGroup() {
        this._syncManager = this._kayraPrefs._syncManager;

        this._syncGroup = new Adw.PreferencesGroup({
            title: _("Sync"),
            description: _("Keep stations and these settings in sync across computers, through a folder you choose (a local path, a Nextcloud/Dropbox folder, or an already-mounted WebDAV location). Pushes automatically when you close this window; checks for remote changes when you open it. PodcastIndex.org credentials are never included."),
        });

        this._syncFolderRow = new Adw.ActionRow({ title: _("Sync folder") });
        let chooseButton = new Gtk.Button({ label: _("Choose…"), valign: Gtk.Align.CENTER });
        chooseButton.connect("clicked", () => this.chooseSyncFolder());
        this._syncFolderRow.add_suffix(chooseButton);
        this._syncGroup.add(this._syncFolderRow);

        this._syncStatusRow = new Adw.ActionRow({ title: _("Status") });
        let syncNowButton = new Gtk.Button({ label: _("Sync now"), valign: Gtk.Align.CENTER });
        syncNowButton.get_style_context().add_class("suggested-action");
        syncNowButton.connect("clicked", () => this.runSync());
        this._syncStatusRow.add_suffix(syncNowButton);
        this._syncGroup.add(this._syncStatusRow);

        this._settingsPage.add(this._syncGroup);
        this.refreshSyncStatus();
      }
      chooseSyncFolder() {
        let dialog = new Gtk.FileDialog({ title: _("Choose sync folder") });
        dialog.select_folder(this._window, null, (source, result) => {
            try {
                let folder = source.select_folder_finish(result);
                this._syncManager.setSyncFolder(folder.get_path());
                this.refreshSyncStatus();
                this.runSync();
            } catch (e) { /* user cancelled */ }
        });
      }
      runSync() {
        this._syncStatusRow.subtitle = _("Syncing…");
        this._syncManager.checkAndSync((status, error) => {
            this.refreshSyncStatus();
            if (status === Sync.Status.ERROR) console.warn(`${Constants.LOG_PREFIX_PREPS} Sync error: [${error}]`);
        });
      }
      refreshSyncStatus() {
        if (!this._syncStatusRow) return;
        let folder = this._syncManager.getSyncFolder();
        this._syncFolderRow.subtitle = folder ?? _("Not set");
        if (!folder) { this._syncStatusRow.subtitle = _("Choose a folder to enable sync."); return; }
        let lastAt = this._syncManager.getLastSyncedAt();
        this._syncStatusRow.subtitle = lastAt
            ? _("Last synced: %s").format(new Date(lastAt).toLocaleString())
            : _("Not synced yet");
      }
      createPodcastIndexGroup() {
        this._podcastGroup = new Adw.PreferencesGroup({
            title: _("PodcastIndex.org"),
            description: _("A free API key is required to search podcasts."),
        });

        this._podcastStatusRow = new Adw.ActionRow({ title: _("Status"), subtitle: _("Checking…") });
        this._podcastGroup.add(this._podcastStatusRow);

        this._podcastKeyRow = new Adw.PasswordEntryRow({ title: _("API Key") });
        this._podcastGroup.add(this._podcastKeyRow);

        this._podcastSecretRow = new Adw.PasswordEntryRow({ title: _("API Secret") });
        this._podcastGroup.add(this._podcastSecretRow);

        let saveRow = new Adw.ActionRow();
        let saveButton = new Gtk.Button({ label: _("Save"), valign: Gtk.Align.CENTER });
        saveButton.get_style_context().add_class("suggested-action");
        saveButton.connect("clicked", () => {
            let key = this._podcastKeyRow.get_text().trim();
            let secret = this._podcastSecretRow.get_text().trim();
            if (Utils.isEmptyString(key) || Utils.isEmptyString(secret)) return;
            PodcastIndex.storeCredentials(key, secret, (success) => {
                this.refreshPodcastStatus();
                if (success) {
                    this._podcastKeyRow.set_text("");
                    this._podcastSecretRow.set_text("");
                }
            });
        });
        saveRow.add_suffix(saveButton);
        this._podcastGroup.add(saveRow);

        let signupLink = new Gtk.LinkButton({
            valign: Gtk.Align.CENTER,
            label: _("Get a free API key"),
            uri: Constants.PODCASTINDEX_SIGNUP_URL,
        });
        let linkRow = new Adw.ActionRow();
        linkRow.add_suffix(signupLink);
        this._podcastGroup.add(linkRow);

        this._settingsPage.add(this._podcastGroup);
        this.refreshPodcastStatus();
      }
      refreshPodcastStatus() {
        PodcastIndex.getCredentials((apiKey, apiSecret) => {
            if (!this._podcastStatusRow) return;
            this._podcastStatusRow.subtitle = (apiKey && apiSecret)
                ? _("Configured — stored in your keyring")
                : _("Not configured yet");
        });
      }
      //Casting is an optional extra on top of the base radio/podcast
      //experience, which always works regardless of this. It needs
      //python3-pychromecast installed; the switch below only controls
      //whether the panel *offers* casting — it doesn't control whether the
      //dependency is present, so the status row always reflects the real,
      //checked state and spells out the install step when it's missing.
      createChromecastGroup() {
        this._chromecastGroup = new Adw.PreferencesGroup({
            title: _("Chromecast"),
            description: _("Cast the current radio station or podcast episode to a Chromecast or Google TV device."),
        });

        this._chromecastEnabledRow = new Adw.SwitchRow({
            title: _("Enable casting"),
            subtitle: _("Shows a \"Cast to…\" option in the panel menu."),
        });
        this._schema.bind(Constants.SCHEMA_CHROMECAST_ENABLED, this._chromecastEnabledRow, "active", Gio.SettingsBindFlags.DEFAULT);
        this._chromecastGroup.add(this._chromecastEnabledRow);

        this._chromecastStatusRow = new Adw.ActionRow({ title: _("Status"), subtitle: _("Checking…") });
        this._chromecastGroup.add(this._chromecastStatusRow);

        this._settingsPage.add(this._chromecastGroup);
        this.refreshChromecastStatus();
      }
      refreshChromecastStatus() {
        Chromecast.isAvailable((available) => {
            if (!this._chromecastStatusRow) return;
            this._chromecastStatusRow.subtitle = available
                ? _("Available")
                : _("Not available — install it with: sudo apt install python3-pychromecast");
        });
      }
}