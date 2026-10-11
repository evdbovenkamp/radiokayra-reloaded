import Gio from "gi://Gio";
import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";
import Pango from "gi://Pango";
import GdkPixbuf from "gi://GdkPixbuf";

import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as Utils from "./utils.js";
import * as Constants from "./constants.js";
import { gettext as _, } from "resource:///org/gnome/shell/extensions/extension.js";

export const ChannelBox = GObject.registerClass(
    class ChannelBox extends PopupMenu.PopupBaseMenuItem {
        constructor(channelInfo, radiokayraPanel) {
            super({
                reactive: true,
                can_focus: true,
            });
            this._channelInfo = channelInfo;
            this._radiokayraPanel = radiokayraPanel;
            this._is_live = false;
            this._duration = 0;

            this.addTypeIcon();
            this.addThumbnail();
            this._channelLabel = new St.Label({
                style_class: Constants.CSS_CHANNEL_LIST_LABEL,
                reactive: true,
                x_align: Clutter.ActorAlign.START,
                x_expand: true,
            });
            this._channelLabel.text = Utils.processSpecialCharacters(
                this._channelInfo.getName(),
                false,
            );
            this._channelLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            this.add_child(this._channelLabel);

            this.addNewEpisodeBadge();
            this.setOrnament(PopupMenu.Ornament.NONE);
        }
        //A small text badge so radio stations and podcasts are unambiguous at
        //a glance in the list — a tiny symbolic icon turned out too easy to
        //miss/misread, text doesn't have that problem. Manually-added
        //direct-link channels show none — genuinely ambiguous what they are.
        addTypeIcon() {
            let label = null;
            if (this._channelInfo.source === Constants.CHANNEL_SOURCE_PODCASTINDEX) label = _("PODCAST");
            else if (this._channelInfo.source === Constants.CHANNEL_SOURCE_RADIOBROWSER) label = _("RADIO");
            if (!label) return;

            this._typeIcon = new St.Label({
                style_class: Constants.CSS_TYPE_BADGE,
                text: label,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.add_child(this._typeIcon);
        }
        //A podcast feed shows a small "new" marker when the last episode we know
        //about (refreshed when the user browses episodes in preferences) differs
        //from the one they last actually played.
        addNewEpisodeBadge() {
            let info = this._channelInfo;
            let hasNewEpisode = info.podcastType === "feed"
                && !Utils.isEmptyString(info.latestEpisodeGuid)
                && info.latestEpisodeGuid !== info.lastSeenEpisodeGuid;
            if (!hasNewEpisode) return;

            this._newBadge = new St.Label({
                style_class: Constants.CSS_NEW_EPISODE_BADGE,
                text: _("new"),
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.add_child(this._newBadge);
        }
        //Marks this row as the currently playing/selected channel with the same
        //dot ornament GNOME's own menus use for a selected item.
        setActive(isActive) {
            this.setOrnament(isActive ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
        }
        clearNewEpisodeBadge(episodeGuid) {
            this._channelInfo.latestEpisodeGuid = episodeGuid;
            this._channelInfo.lastSeenEpisodeGuid = episodeGuid;
            this._newBadge?.destroy();
            this._newBadge = null;
        }
       
        clear() {
            this._typeIcon?.destroy();
            this._typeIcon = null;

            this._thumbnail?.destroy();
            this._thumbnail = null;

            this._channelLabel?.destroy();
            this._channelLabel = null;

            this._newBadge?.destroy();
            this._newBadge = null;
        }
        doesThumbnailExist() {
            let thumbNailPath = Utils.getConfigPath() + "/" + this._channelInfo.getId();
            let thumbNailFile = Gio.file_new_for_path(thumbNailPath);
            return thumbNailFile.query_exists(null);
        }
        addThumbnail() {
            this._thumbnail = new St.Icon({ style_class: Constants.CSS_CHANNEL_LIST_THUMBNAIL });
            this._thumbnail.set_icon_size(Constants.CHANNEL_LIST_THUMB_SIZE);

            if (this.doesThumbnailExist()) {
                try {
                    let thumbNailPath =
                        Utils.getConfigPath() + "/" + this._channelInfo.getId();
                    this._thumbnail.gicon = Gio.icon_new_for_string(thumbNailPath);
                    this._thumbnail.show();

                    const pixbuf = GdkPixbuf.Pixbuf.new_from_file(thumbNailPath);

                    const width = pixbuf.get_width();
                    const height = pixbuf.get_height();

                    this._thumbnail.set_scale(width / height, 1);
                    this._thumbnail.set_pivot_point(0.5, 0.5);
                }
                catch (error) {
                    console.warn(`${Constants.LOG_PREFIX_POPUPS} ${Constants.LOG_ADD_THUMBNAIL_ERROR}:[${error}]`);                    
                }
            }
            else {
                this._thumbnail.set_icon_name(Constants.ICON_CHANNEL_THUMB_PLACEHOLDER);
            }
            this.add_child(this._thumbnail);
        }

        activate() {
            this._radiokayraPanel.onChannelChanged(this);
        }
    },
);
