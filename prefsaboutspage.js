import Adw from "gi://Adw";
import Gtk from "gi://Gtk";

import * as Constants from "./constants.js";
import { gettext as _, } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

export const AboutPageHandler = class AboutPageHandler {
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
        this._aboutPage = new Adw.PreferencesPage();
        this._aboutPage.title = _("About");        
        this._aboutPage.icon_name = Constants.ICON_ABOUT;
    
        this._window.add(this._aboutPage);
        this._rows = [];
        let title_text = 'Radio Kayra Reloaded\n';
        title_text += _('An independent fork, originally by Ayhan Avcı');

        this.about = new Adw.PreferencesGroup({ title: title_text, description: _("Mid clicking the radio icon toggles play / stop.\nDon't forget to install gstreamer. Links at the bottom. Enjoy!")});
        this._aboutPage.add(this.about);

        this._urlsGroup = new Adw.PreferencesGroup({ title: _('Links')});

        let row = new Adw.ActionRow();
        row.title = _("Original project");
        let newLink = new Gtk.LinkButton({
          valign: Gtk.Align.CENTER,
          label: "https://github.com/ayhanavci/radiokayra",
          focusable: 1,
          uri: "https://github.com/ayhanavci/radiokayra"
        });
        row.add_suffix(newLink);
        this._urlsGroup.add(row);

        row = new Adw.ActionRow();
        row.title = _("GStreamer");
        newLink = new Gtk.LinkButton({
          valign: Gtk.Align.CENTER,
          label: "https://gstreamer.freedesktop.org/download/#linux",
          focusable: 1,
          uri: "https://gstreamer.freedesktop.org/download/#linux"
        });        
        row.add_suffix(newLink);        
        this._urlsGroup.add(row);         

        this._aboutPage.add(this._urlsGroup);
      }           
 
}