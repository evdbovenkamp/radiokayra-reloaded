import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";

import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as Constants from "./constants.js";
import { gettext as _, } from "resource:///org/gnome/shell/extensions/extension.js";

export const ControlsPopup = GObject.registerClass(
    {
        GTypeName: "ControlsPopup",
    },
    class extends PopupMenu.PopupBaseMenuItem {
        constructor(shellVersion) {
            super({
                hover: false,
                activate: false,
                can_focus: true,
            });
            this._play_click_handler = null;
            this._controlsLayout = new St.BoxLayout({
                style_class: "radiokayra-controls-box",
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            //Gnome 48 or below? //Alternative: this._controlsLayout.orientation === undefined
            if (shellVersion < 48) this._controlsLayout.vertical = false;
            else this._controlsLayout.orientation = Clutter.Orientation.HORIZONTAL;

            this.add_child(this._controlsLayout);

            this._previousbutton = this._createIconButton(Constants.ICON_BACKWARD, Constants.PLAY_PREV_ICON_SIZE, Clutter.ActorAlign.START);
            this._controlsLayout.add_child(this._previousbutton);

            this._playbutton = this._createIconButton(Constants.ICON_PLAY, Constants.PLAY_ICON_SIZE, Clutter.ActorAlign.CENTER);
            this._controlsLayout.add_child(this._playbutton);

            this._nextbutton = this._createIconButton(Constants.ICON_FORWARD, Constants.PLAY_NEXT_ICON_SIZE, Clutter.ActorAlign.END);
            this._controlsLayout.add_child(this._nextbutton);
        }
        //St.Icon never gets :hover/:active theme states; St.Button does, so controls
        //get the same circular hover highlight as e.g. the Quick Settings buttons.
        _createIconButton(iconName, iconSize, xAlign) {
            return new St.Button({
                style_class: "icon-button",
                child: new St.Icon({ icon_name: iconName, icon_size: iconSize }),
                x_align: xAlign,
                x_expand: false,
            });
        }
        clear() {
            if (this._play_click_handler !== null)
                this.disconnect(this._play_click_handler);

            this._controlsLayout?.destroy();
            this._controlsLayout = null;

            this._playbutton?.destroy();
            this._playbutton = null;
        }
        statePlaying() { this._playbutton.child.set_icon_name(Constants.ICON_STOP); }
        stateLoading() { this._playbutton.child.set_icon_name(Constants.ICON_STOP); }
        stateReady() { this._playbutton.child.set_icon_name(Constants.ICON_PLAY); }
        setOnPlayClicked(onPlayClicked) {
            this._playbutton.connect("clicked", () => onPlayClicked());
        }
        setOnPlayNextClicked(onPlayNextClicked) {
            this._nextbutton.connect("clicked", () => onPlayNextClicked());
        }
        setOnPlayPrevClicked(onPlayPrevClicked) {
            this._previousbutton.connect("clicked", () => onPlayPrevClicked());
        }
    },
);
