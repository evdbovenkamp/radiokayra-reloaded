import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";

import * as Channels from "./channels.js";
import * as PodcastIndex from "./podcastindex.js";
import * as Utils from "./utils.js";
import * as Constants from "./constants.js";
import { gettext as _, } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

export const StationsPageHandler = class StationsPageHandler {
    constructor(kayraPrefs) {
        this._kayraPrefs = kayraPrefs;
        this._window = kayraPrefs._window;        
    }
    clear() {
        this._channelGroup = null;
        this._stationsPage = null;
        this._rows = null;
    }
    createPage() {
        this._stationsPage = new Adw.PreferencesPage();
        this._stationsPage.title = _("Stations");
        this._stationsPage.description = _("Add / Edit and Delete radio stations.");
        this._stationsPage.icon_name = Constants.ICON_STATIONS_PAGE;

        this._window.add(this._stationsPage);
        this._rows = [];
        this._channelGroup = new Adw.PreferencesGroup();

        const row = new Adw.ActionRow();
        row.title = _("Radio Channels");
        const addNewButton = new Gtk.Button({
            valign: Gtk.Align.CENTER,
            icon_name: Constants.ICON_ADD_CHANNEL,
        });
        addNewButton.get_style_context().add_class("circular");
        addNewButton.connect("clicked", () => { this.openEditWindow(null); });
        row.add_suffix(addNewButton);
        this._channelGroup.add(row);

        this.populateChannels(this._channelGroup);
        this._stationsPage.add(this._channelGroup);
    }

    populateChannels() {
        this._channelsReadWrite = new Channels.ChannelsReadWrite(this._kayraPrefs.path);
        this._channels = this._channelsReadWrite.getChannels();
        this._channels.sort((a, b) => parseInt(a.order) - parseInt(b.order));

        for (let index = 0; index < this._channels.length; ++index) {
            let channelData = this._channels[index];
            let channelInfo = new Channels.ChannelInfo(
                channelData.id,
                channelData.name,
                channelData.uri,
                channelData.order,
                channelData
            );
            this.fillChannelRow(channelInfo);
        }
    }
    //A clear, unambiguous type label leads every subtitle — a tiny icon
    //turned out too easy to miss/misread at a glance; text doesn't have
    //that problem. Manually-added direct-link channels show none —
    //genuinely ambiguous what they are.
    getSourceTypeLabel(channelInfo) {
        if (channelInfo.source === Constants.CHANNEL_SOURCE_PODCASTINDEX) return _("Podcast");
        if (channelInfo.source === Constants.CHANNEL_SOURCE_RADIOBROWSER) return _("Radio");
        return null;
    }
    //Branches on source: radio-browser.info stations show country/codec/bitrate,
    //podcast feeds show author/episode count, podcast episodes show their own date.
    buildSubtitle(channelInfo) {
        let parts = [];
        let typeLabel = this.getSourceTypeLabel(channelInfo);
        if (typeLabel) parts.push(typeLabel);

        if (channelInfo.source === Constants.CHANNEL_SOURCE_PODCASTINDEX) {
            if (channelInfo.podcastType === "episode") {
                if (!Utils.isEmptyString(channelInfo.feedTitle)) parts.push(channelInfo.feedTitle);
                if (!Utils.isEmptyString(channelInfo.datePublished)) {
                    let date = GLib.DateTime.new_from_unix_local(channelInfo.datePublished);
                    parts.push(date.format("%d-%m-%Y"));
                }
            } else {
                if (!Utils.isEmptyString(channelInfo.author)) parts.push(channelInfo.author);
                if (!Utils.isEmptyString(channelInfo.episodeCount)) parts.push(_("%d episodes").format(channelInfo.episodeCount));
                if (channelInfo.latestEpisodeGuid && channelInfo.latestEpisodeGuid !== channelInfo.lastSeenEpisodeGuid)
                    parts.push(_("new episode"));
            }
        } else {
            if (!Utils.isEmptyString(channelInfo.country)) parts.push(channelInfo.country);
            if (!Utils.isEmptyString(channelInfo.codec)) parts.push(channelInfo.codec);
            if (!Utils.isEmptyString(channelInfo.bitrate)) parts.push(`${channelInfo.bitrate}kb/s`);
        }
        return parts.join(" · ");
    }
    fillChannelRow(channelInfo) {
        const row = new Adw.ActionRow();
        this._rows.push(row);
        row.name = channelInfo.id;
        row.title = channelInfo.name;

        row.subtitle = this.buildSubtitle(channelInfo);

        let thumbNailPath = Utils.getConfigPath() + "/" + channelInfo.id;
        let thumbNailFile = Gio.file_new_for_path(thumbNailPath);
        const thumbNail = new Gtk.Image({
            valign: Gtk.Align.CENTER,
            pixel_size: 32,
        });
        if (thumbNailFile.query_exists(null)) thumbNail.set_from_file(thumbNailPath);
        else thumbNail.set_from_icon_name(Constants.ICON_CHANNEL_THUMB_PLACEHOLDER);
        row.add_prefix(thumbNail);

        const deleteButton = new Gtk.Button({
            valign: Gtk.Align.CENTER,
            icon_name: Constants.ICON_DELETE_CHANNEL,
        });

        deleteButton.get_style_context().add_class("circular");
        deleteButton.connect("clicked", () => {
            this._channelGroup.remove(row);
            this.removeChannel(row);
        });
        row.add_suffix(deleteButton);

        const editButton = new Gtk.Button({
            valign: Gtk.Align.CENTER,
            icon_name: Constants.ICON_EDIT_CHANNEL,
        });
        editButton.get_style_context().add_class("circular");
        editButton.connect("clicked", () => { this.openEditWindow(row); });
        row.add_suffix(editButton);

        if (channelInfo.source === Constants.CHANNEL_SOURCE_PODCASTINDEX && channelInfo.podcastType === "feed") {
            const episodesButton = new Gtk.Button({
                valign: Gtk.Align.CENTER,
                icon_name: "view-list-symbolic",
                tooltip_text: _("Browse episodes"),
            });
            episodesButton.get_style_context().add_class("circular");
            episodesButton.connect("clicked", () => { this.openEpisodesWindow(channelInfo); });
            row.add_suffix(episodesButton);
        }

        const moveDownButton = new Gtk.Button({
            valign: Gtk.Align.CENTER,
            icon_name: Constants.ICON_MOVE_DOWN,
        });
        moveDownButton.get_style_context().add_class("circular");
        moveDownButton.connect("clicked", () => {
            //this.moveDownChannel(channelInfo.id);
            this.moveDownChannel(row);
            console.info("Move Down:[" + row.name + "]");
        });
        row.add_suffix(moveDownButton);

        const moveUpButton = new Gtk.Button({
            valign: Gtk.Align.CENTER,
            icon_name: Constants.ICON_MOVE_UP,
        });
        moveUpButton.get_style_context().add_class("circular");
        moveUpButton.connect("clicked", () => {
            //this.moveUpChannel(channelInfo.id);
            this.moveUpChannel(row);
            console.info("Move up:[" + row.name + "]");
        });
        row.add_suffix(moveUpButton);

        this._channelGroup.add(row);
    }
    removeChannel(row) {
        let id = row.name;
        for (let index = 0; index < this._channels.length; ++index) {
            let channelData = this._channels[index];
            if (channelData.id === id) {
                this._channels.splice(index, 1);
                this.writeChannels();

                //Delete thumbnail, if exists
                let thumbNailPath = Utils.getConfigPath() + "/" + id;
                let thumbNailFile = Gio.file_new_for_path(thumbNailPath);
                if (thumbNailFile.query_exists(null)) thumbNailFile.delete(null);

                break;
            }
        }
    }
    writeChannels() {
        this._kayraPrefs._channelsChanged = true;
        this._channels.sort((a, b) => parseInt(a.order) - parseInt(b.order));
        for (let index = 0; index < this._channels.length; ++index) this._channels[index].order = index;

        this._channelsReadWrite.writeChannelsFile(this._channels);
    }
    moveDownChannel(row) {
        let id = row.name;
        if (this._rows[this._rows.length - 1].name === id) 
            return;  //This was the last row. Nothing to do
        
        for (let index = 0; index < this._channels.length - 1; ++index) {
            let channelData = this._channels[index];
            if (channelData.id === id) {
                let tempOrder = this._channels[index].order;
                this._channels[index].order = this._channels[index + 1].order;
                this._channels[index + 1].order = tempOrder;
                this.writeChannels();
                break;
            }
        }
        
        for (let index = 0; index < this._rows.length - 1; ++index) {
            let curRow = this._rows[index];
            if (curRow.name === id) {
                this.swapChannels(index, index + 1);
                break;
            }

        }
    }
    
    moveUpChannel(row) {        
        let id = row.name;
        console.error(`NEW CHANGES. MOVEUP ROW:[${row}] ID:[${id}]`);
        if (this._rows[0].name === id) 
            return;  //This was the first row. Nothing to do

        for (let index = 1; index < this._channels.length; ++index) {
            let channelData = this._channels[index];
            if (channelData.id === id) {
                console.error(`NEW CHANGES. MOVEUP FOUND ROW ID:[${id}]`);
                let tempOrder = this._channels[index].order;
                this._channels[index].order = this._channels[index - 1].order;
                this._channels[index - 1].order = tempOrder;
                this.writeChannels();                
                break;
            }
        }

        for (let index = 1; index < this._rows.length; ++index) {
            let curRow = this._rows[index];
            if (curRow.name === id) {                
                this.swapChannels(index, index - 1);
                break;
            }

        }
    }
    swapChannels(index1, index2) {
        let tempId = this._rows[index1].name;
        let tempTitle = this._rows[index1].title;

        this._rows[index1].name = this._rows[index2].name;
        this._rows[index1].title = this._rows[index2].title;

        this._rows[index2].name = tempId;
        this._rows[index2].title = tempTitle;
    }

    //Browsing episodes can't play anything here (prefs runs in its own process,
    //separate from the panel's player) — it's purely for picking an older episode
    //to add as its own standalone station, and for refreshing the "new episode"
    //badge the panel shows for this feed.
    openEpisodesWindow(feedChannelInfo) {
        let dialog = new Adw.Dialog();
        dialog.set_title(feedChannelInfo.name);
        dialog.set_content_width(480);
        dialog.set_content_height(500);
        dialog.set_presentation_mode(Adw.ADW_DIALOG_BOTTOM_SHEET);
        dialog.set_can_close(true);

        let toolbarView = new Adw.ToolbarView();
        toolbarView.add_top_bar(new Adw.HeaderBar());

        let page = new Adw.PreferencesPage();
        let group = new Adw.PreferencesGroup({ title: _("Episodes") });
        page.add(group);
        toolbarView.set_content(page);
        dialog.set_child(toolbarView);
        dialog.present(this._window);

        let loadingRow = new Adw.ActionRow({ title: _("Loading episodes…") });
        group.add(loadingRow);

        PodcastIndex.getEpisodes(feedChannelInfo.feedId, (episodes, error) => {
            group.remove(loadingRow);
            if (error) { group.add(new Adw.ActionRow({ title: error })); return; }
            if (episodes.length === 0) { group.add(new Adw.ActionRow({ title: _("No episodes found.") })); return; }

            //Refresh the "new episode" marker (doesn't mark as seen; only playing does that).
            if (episodes[0].guid) this.updateChannelField(feedChannelInfo.id, "latestEpisodeGuid", episodes[0].guid);

            episodes.forEach(episode => {
                let minutes = Utils.isEmptyString(episode.duration) ? "" : `${Math.round(episode.duration / 60)} min`;
                let date = Utils.isEmptyString(episode.datePublished) ? "" : GLib.DateTime.new_from_unix_local(episode.datePublished).format("%d-%m-%Y");
                let row = new Adw.ActionRow({ title: episode.title ?? "" , subtitle: [date, minutes].filter(p => !Utils.isEmptyString(p)).join(" · ")});
                let addButton = new Gtk.Button({ valign: Gtk.Align.CENTER, icon_name: Constants.ICON_ADD_CHANNEL });
                addButton.get_style_context().add_class("circular");
                addButton.connect("clicked", () => {
                    let added = this.addEpisodeAsChannel(feedChannelInfo, episode);
                    addButton.set_icon_name(added ? "object-select-symbolic" : Constants.ICON_ADD_CHANNEL);
                    addButton.set_sensitive(false);
                });
                row.add_suffix(addButton);
                group.add(row);
            });
        });
    }

    addEpisodeAsChannel(feedChannelInfo, episode) {
        let id = Utils.isEmptyString(episode.guid) ? Utils.uuidv4() : episode.guid;
        if (this.channelExistsById(id)) return false;

        this.addChannelInfo(id, episode.title, episode.enclosureUrl, {
            source: Constants.CHANNEL_SOURCE_PODCASTINDEX,
            podcastType: "episode",
            feedId: feedChannelInfo.feedId,
            feedTitle: feedChannelInfo.name,
            favicon: episode.image ?? feedChannelInfo.favicon ?? null,
            duration: episode.duration ?? null,
            datePublished: episode.datePublished ?? null,
        });
        let artwork = episode.image ?? feedChannelInfo.favicon;
        if (artwork) Utils.saveThumbnail(artwork, Utils.getConfigPath() + "/" + id);
        return true;
    }

    //Patches a single field on a stored channel without touching the rest
    //(used to refresh podcast metadata like latestEpisodeGuid).
    updateChannelField(id, field, value) {
        for (let index = 0; index < this._channels.length; ++index) {
            if (this._channels[index].id === id) {
                this._channels[index][field] = value;
                this._channelsReadWrite.writeChannelsFile(this._channels);
                this._kayraPrefs.channelsChanged = true;
                return;
            }
        }
    }


    openEditWindow(row) {
        let id = null;
        if (row !== null) id = row.name;

        let channelInfo = null;
        if (id !== null) {
            channelInfo = this.getChannelInfoById(id);
            if (channelInfo === null) console.warn(`${Constants.LOG_FAILED_TO_FIND_CHANNEL} ${Constants.LOG_PREFIX_PREPS}:[${id}]`);
        }

        let dialog = new Adw.Dialog();
        dialog.set_title(channelInfo === null ? _("Add a New Channel") : _("Edit Channel"));
        dialog.set_content_width(480);
        dialog.set_presentation_mode(Adw.ADW_DIALOG_BOTTOM_SHEET);
        dialog.set_can_close(true);

        let toolbarView = new Adw.ToolbarView();
        toolbarView.add_top_bar(new Adw.HeaderBar());

        let page = new Adw.PreferencesPage();
        let group = new Adw.PreferencesGroup();

        this.uriEntry = new Adw.EntryRow({ title: _("Channel URL") });
        group.add(this.uriEntry);

        this.nameEntry = new Adw.EntryRow({ title: _("Channel Name") });
        group.add(this.nameEntry);

        page.add(group);

        let saveChannelButton = new Gtk.Button({
            label: channelInfo === null ? _("Add") : _("Update"),
            halign: Gtk.Align.END,
            margin_top: 6,
            margin_end: 20,
            margin_bottom: 20,
        });
        saveChannelButton.get_style_context().add_class("suggested-action");
        saveChannelButton.connect("clicked", () => {
            //Get Info from UI
            let uri = this.uriEntry.get_text();
            let name = this.nameEntry.get_text();

            //Encode special characters
            let encodedUri = Utils.processSpecialCharacters(uri, true);
            let encodedName = Utils.processSpecialCharacters(name, true);

            //Save Info
            if (channelInfo !== null) { //Update channel
                this.updateChannelInfo(
                    row,
                    channelInfo.id,
                    encodedName,
                    encodedUri,
                );
            }
            else if (!this.channelExists(encodedUri))  //New channel, new Uri
                this.addChannelInfo(Utils.uuidv4(), encodedName, encodedUri);
            else  //New channel but Uri already exists
                console.info("New channel uri:[" + encodedUri + "] already exists");

            dialog.close();
        });

        let contentBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
        contentBox.append(page);
        contentBox.append(saveChannelButton);
        toolbarView.set_content(contentBox);

        if (channelInfo !== null) {
            //Load decoded uri from file into UI
            let decodedUri = Utils.processSpecialCharacters(
                channelInfo.getUri(),
                false,
            );
            this.uriEntry.set_text(decodedUri);

            //Load decoded name from file into UI
            let decodedName = Utils.processSpecialCharacters(
                channelInfo.getName(),
                false,
            );
            this.nameEntry.set_text(decodedName);
        }

        dialog.set_child(toolbarView);
        dialog.present(this._window);
    }

    getChannelInfoById(id) {
        let channelInfo = null;
        for (let index = 0; index < this._channels.length; ++index) {
            let channelData = this._channels[index];
            if (channelData.id === id) {
                channelInfo = new Channels.ChannelInfo(
                    channelData.id,
                    channelData.name,
                    channelData.uri,
                    channelData.order,
                    channelData
                );
                break;
            }
        }
        return channelInfo;
    }
    updateChannelInfo(row, id, name, uri) {
        for (let index = 0; index < this._channels.length; ++index) {
            let channelData = this._channels[index];
            if (channelData.id === id) {
                this._channels[index].name = name;
                this._channels[index].uri = uri;
                this.writeChannels();
                row.name = id;
                row.title = name;
                return;
            }
        }
    }

    addChannelInfo(newId, newName, newUri, extraMeta = {}) {
        let newOrder = this._channels.length + 1;
        const newChannel = {
            id: newId,
            name: newName,
            order: newOrder,
            uri: newUri,
            ...extraMeta,
        };
        this._channels.push(newChannel);
        this.writeChannels();
        let channelInfo = new Channels.ChannelInfo(
            newId,
            newName,
            newUri,
            newOrder,
            extraMeta
        );
        this.fillChannelRow(channelInfo);
    }
    channelExists(encodedUri) {
        for (let index = 0; index < this._channels.length; ++index) {
            if (this._channels[index].uri === encodedUri) return true;
        }
        return false;
    }
    channelExistsById(id) {
        return this._channels.some(channel => channel.id === id);
    }

}