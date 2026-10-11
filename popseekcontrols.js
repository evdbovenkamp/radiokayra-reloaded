import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";

import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as Slider from "resource:///org/gnome/shell/ui/slider.js";

import * as Constants from "./constants.js";
import { gettext as _, } from "resource:///org/gnome/shell/extensions/extension.js";

//Seek slider + skip/episode-nav buttons for podcast episodes. Hidden entirely
//for radio (and whenever nothing seekable is playing) via show()/hide();
//kayramenu.js owns the position-poll timer and pushes updates in via
//updateProgress() — this widget is purely presentational, like ControlsPopup.
export const SeekControlsPopup = GObject.registerClass(
    {
        GTypeName: "SeekControlsPopup",
    },
    class extends PopupMenu.PopupBaseMenuItem {
        constructor(shellVersion) {
            super({
                hover: false,
                activate: false,
                can_focus: true,
            });
            this._duration = null;
            this._dragging = false;

            this._layout = new St.BoxLayout({
                style_class: "layout-box",
                x_align: Clutter.ActorAlign.CENTER,
            });
            if (shellVersion < 48) this._layout.vertical = true;
            else this._layout.orientation = Clutter.Orientation.VERTICAL;
            this.add_child(this._layout);

            //Time label
            this._timeLabel = new St.Label({
                style_class: Constants.CSS_SEEK_TIME_LABEL,
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            this._layout.add_child(this._timeLabel);

            //Seek row: -15s, slider, +30s
            this._seekRow = new St.BoxLayout({ x_expand: true });
            this._seekBackButton = this._iconButton(Constants.ICON_SEEK_BACKWARD,
                _("Back %d seconds").format(Constants.SEEK_BACK_SECONDS));
            this._seekRow.add_child(this._seekBackButton);

            this._slider = new Slider.Slider(0);
            this._slider.x_expand = true;
            this._slider_drag_end_handler = this._slider.connect("drag-end", () => this._onDragEnd());
            this._slider_value_handler = this._slider.connect("notify::value", () => this._onValueChanged());
            this._seekRow.add_child(this._slider);

            this._seekForwardButton = this._iconButton(Constants.ICON_SEEK_FORWARD,
                _("Forward %d seconds").format(Constants.SEEK_FORWARD_SECONDS));
            this._seekRow.add_child(this._seekForwardButton);
            this._layout.add_child(this._seekRow);

            //Episode nav row
            this._episodeRow = new St.BoxLayout({ x_align: Clutter.ActorAlign.CENTER });
            this._prevEpisodeButton = this._iconButton(Constants.ICON_EPISODE_PREV, _("Previous episode"), Constants.EPISODE_NAV_ICON_SIZE);
            this._episodeRow.add_child(this._prevEpisodeButton);
            this._nextEpisodeButton = this._iconButton(Constants.ICON_EPISODE_NEXT, _("Next episode"), Constants.EPISODE_NAV_ICON_SIZE);
            this._episodeRow.add_child(this._nextEpisodeButton);
            this._layout.add_child(this._episodeRow);

            this.hide();
        }
        _iconButton(iconName, tooltipText, size = Constants.SEEK_ICON_SIZE) {
            const button = new St.Button({
                style_class: "icon-button",
                child: new St.Icon({ icon_name: iconName, icon_size: size }),
            });
            button.set_accessible_name(tooltipText);
            return button;
        }
        clear() {
            this._slider?.disconnect(this._slider_drag_end_handler);
            this._slider?.disconnect(this._slider_value_handler);
            this._layout?.destroy();
            this._layout = null;
        }

        //Call once seekability of the current channel is known, before any
        //updateProgress(); null duration means "unknown yet", still shown.
        showForEpisode() { this.show(); }
        hideForRadio() { this.hide(); }

        //positionSeconds/durationSeconds, or null if not known yet.
        updateProgress(positionSeconds, durationSeconds) {
            this._duration = durationSeconds;
            this._timeLabel.text = `${this._formatTime(positionSeconds)} / ${this._formatTime(durationSeconds)}`;
            if (!this._dragging && durationSeconds) {
                this._slider.block_signal_handler(this._slider_value_handler);
                this._slider.value = Math.min(1, Math.max(0, (positionSeconds ?? 0) / durationSeconds));
                this._slider.unblock_signal_handler(this._slider_value_handler);
            }
        }
        _formatTime(seconds) {
            if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "--:--";
            seconds = Math.floor(seconds);
            let h = Math.floor(seconds / 3600);
            let m = Math.floor((seconds % 3600) / 60);
            let s = seconds % 60;
            let mm = String(m).padStart(h > 0 ? 2 : 1, "0");
            let ss = String(s).padStart(2, "0");
            return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
        }
        _onValueChanged() {
            this._dragging = true;
            if (this._duration) this._timeLabel.text = `${this._formatTime(this._slider.value * this._duration)} / ${this._formatTime(this._duration)}`;
        }
        _onDragEnd() {
            this._dragging = false;
            if (this._duration && this.onSeekDrag) this.onSeekDrag(this._slider.value * this._duration);
        }

        setOnSeekBack(cb) { this._seekBackButton.connect("clicked", () => cb()); }
        setOnSeekForward(cb) { this._seekForwardButton.connect("clicked", () => cb()); }
        setOnPrevEpisode(cb) { this._prevEpisodeButton.connect("clicked", () => cb()); }
        setOnNextEpisode(cb) { this._nextEpisodeButton.connect("clicked", () => cb()); }
        setOnSeekDrag(cb) { this.onSeekDrag = cb; }
        setEpisodeNavEnabled(enabled) {
            this._prevEpisodeButton.reactive = enabled;
            this._nextEpisodeButton.reactive = enabled;
            this._prevEpisodeButton.opacity = enabled ? 255 : 80;
            this._nextEpisodeButton.opacity = enabled ? 255 : 80;
        }
    },
);
