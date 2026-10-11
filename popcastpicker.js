import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";

import * as ModalDialog from "resource:///org/gnome/shell/ui/modalDialog.js";
import * as Constants from "./constants.js";

//A proper full-screen device picker, replacing an earlier attempt that put
//the device list in a nested panel submenu — that turned out unreliable
//(the submenu wouldn't expand for every user) and was cramped besides. A
//ModalDialog is the same mechanism GNOME Shell's own system dialogs use.
export const CastPickerDialog = GObject.registerClass(
    class CastPickerDialog extends ModalDialog.ModalDialog {
        //castingDeviceName: non-null if a cast session is already active —
        //shows a "Stop casting" row above the device list.
        //onDeviceChosen(uuid, name) / onStopCasting(): caller's handlers;
        //this dialog only decides what was clicked, never talks to
        //chromecast.js directly.
        _init(castingDeviceName, onDeviceChosen, onStopCasting) {
            super._init({ styleClass: "cast-picker-dialog" });
            this._onDeviceChosen = onDeviceChosen;

            let title = new St.Label({ text: _("Cast to…"), style_class: "cast-picker-title" });
            this.contentLayout.add_child(title);

            this._listBox = new St.BoxLayout({
                vertical: true,
                style_class: "cast-picker-list",
            });
            this.contentLayout.add_child(this._listBox);

            if (castingDeviceName) {
                let stopRow = this._addRow(_("Stop casting (%s)").format(castingDeviceName), "cast-picker-stop-row");
                stopRow.connect("clicked", () => { onStopCasting(); this.close(); });
            }

            this._statusLabel = new St.Label({ text: _("Searching for devices…"), style_class: "cast-picker-status" });
            this._listBox.add_child(this._statusLabel);

            this.setButtons([
                { label: _("Cancel"), action: () => this.close(), key: Clutter.KEY_Escape },
            ]);
        }
        _addRow(text, extraStyleClass) {
            let button = new St.Button({
                style_class: extraStyleClass ? `cast-picker-device-row ${extraStyleClass}` : "cast-picker-device-row",
                x_expand: true,
                can_focus: true,
                label: text,
            });
            this._listBox.add_child(button);
            return button;
        }
        //Called once Chromecast.discoverDevices() resolves. Safe to skip if
        //the dialog was already closed/destroyed by the time it resolves —
        //the caller checks that before calling in.
        showDevices(devices) {
            console.log(`${Constants.LOG_PREFIX_EXTENSION} CastPicker: showDevices called with ${devices.length} device(s)`);
            this._statusLabel?.destroy();
            this._statusLabel = null;
            if (devices.length === 0) {
                this._listBox.add_child(new St.Label({ text: _("No devices found"), style_class: "cast-picker-status" }));
                return;
            }
            devices.forEach((device) => {
                let row = this._addRow(device.name);
                row.connect("clicked", () => {
                    this._onDeviceChosen(device.uuid, device.name);
                    this.close();
                });
            });
        }
    },
);
