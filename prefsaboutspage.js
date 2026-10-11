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

        this.about = new Adw.PreferencesGroup({
            title: "Radio Kayra Reloaded",
            description: _("Maintained by Erwin van den Bovenkamp, built together with Claude AI.\nMiddle-click the radio icon to toggle play/stop. Don't forget to install GStreamer — links at the bottom. Enjoy!"),
        });

        //A small Easter egg — double-click the radio for a thank-you note.
        let radioLabel = new Gtk.Label({ label: "📻", css_classes: ["title-1"] });
        let clickGesture = new Gtk.GestureClick();
        clickGesture.connect("pressed", (_gesture, nPress) => {
            if (nPress === 2) this.showEasterEgg();
        });
        radioLabel.add_controller(clickGesture);

        let headerRow = new Adw.ActionRow({
            title: _("Radio Kayra Reloaded"),
            subtitle: _("psst… try double-clicking the radio"),
        });
        headerRow.add_prefix(radioLabel);
        this.about.add(headerRow);

        this._aboutPage.add(this.about);

        this._creditsGroup = new Adw.PreferencesGroup({ title: _("Credits") });
        let creditsRow = new Adw.ActionRow({
            title: _("Built on the work of Ayhan Avcı"),
            subtitle: _("This fork exists because Ayhan built something worth building on. The original Radio Kayra is the foundation everything here still stands on — thank you."),
        });
        creditsRow.subtitle_lines = 0;
        this._creditsGroup.add(creditsRow);
        this._aboutPage.add(this._creditsGroup);

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
      showEasterEgg() {
        let dialog = new Adw.AlertDialog({
            heading: _("📻 You found it!"),
            body: _("Thanks for poking around, Erwin. Keep the dial tuned — and thank you for building (and rebuilding) this little radio with so much care."),
        });
        dialog.add_response("ok", _("Nice"));
        dialog.present(this._window);
      }
}
