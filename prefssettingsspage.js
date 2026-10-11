import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";

import * as Constants from "./constants.js";
import * as PodcastIndex from "./podcastindex.js";
import * as Utils from "./utils.js";

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

        this.createPodcastIndexGroup();
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
 
}