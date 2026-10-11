import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import GLib from 'gi://GLib';
import Gio from "gi://Gio";
import Gdk from 'gi://Gdk';
import GIRepository from "gi://GIRepository";
import Soup from 'gi://Soup?version=3.0';
import * as Utils from "./utils.js";
import * as Constants from "./constants.js";
import * as PodcastIndex from "./podcastindex.js";
import { COUNTRIES, flagForCountryCode } from "./countries.js";
import { gettext as _, } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

//A typelib probe, not an import — never pulls Gst into the module graph,
//so this stays safe to call even when GStreamer isn't installed at all
//(mirrors extension.js's isGstreamerAvailable() for the panel player).
function isGstreamerAvailable() {
    try {
        GIRepository.Repository.dup_default().require("Gst", "1.0", 0);
        return true;
    } catch (e) {
        return false;
    }
}

const MODE_RADIO = "radio";
const MODE_PODCAST = "podcast";

//A single "Search" page covering both sources (radio-browser.info and
//PodcastIndex.org). A linked toggle picks the mode; the mode-specific filter
//rows show/hide accordingly, but the search entry and results group are shared.
export const SearchPageHandler = class SearchPageHandler {
    constructor(kayraPrefs) {
        this._kayraPrefs = kayraPrefs;
        this._window = kayraPrefs._window;
        this._mode = MODE_RADIO;
        this._lastFeeds = [];
        this._gstAvailable = isGstreamerAvailable();
        this._previewPlayer = null; //dynamically imported on first actual use
        this._activePreviewButton = null;

        this._httpSession = new Soup.Session({
            user_agent: Constants.RADIO_BROWSER_USER_AGENT,
            timeout: 10
        });
        this.server = null;
        this._pendingSearch = false;
        Utils.resolveRadioBrowserServer((server) => {
            this.server = server;
            if (this._pendingSearch) {
                this._pendingSearch = false;
                this.search();
            }
        });
    }
    clear() {
        this.stopPreview();
        this._httpSession = null;
    }

    createPage() {
        this._searchPage = new Adw.PreferencesPage();
        this._searchPage.title = _("Search");
        this._searchPage.icon_name = Constants.ICON_RADIO_SEARCH_PAGE;
        this._window.add(this._searchPage);

        this._searchGroup = new Adw.PreferencesGroup();
        this._searchGroup.title = _("Search");
        this._searchGroup.description = _("Radio via radio-browser.info, podcasts via podcastindex.org.");

        //Mode toggle: a linked pair of buttons, the same pattern GNOME Settings uses.
        let modeBox = new Gtk.Box({ css_classes: ["linked"], halign: Gtk.Align.CENTER, margin_bottom: 6 });
        this._radioModeButton = new Gtk.ToggleButton({ label: _("Radio"), active: true });
        this._podcastModeButton = new Gtk.ToggleButton({ label: _("Podcasts"), group: this._radioModeButton });
        this._radioModeButton.connect("toggled", () => {
            if (this._radioModeButton.get_active()) this.setMode(MODE_RADIO);
        });
        this._podcastModeButton.connect("toggled", () => {
            if (this._podcastModeButton.get_active()) this.setMode(MODE_PODCAST);
        });
        modeBox.append(this._radioModeButton);
        modeBox.append(this._podcastModeButton);

        let modeRow = new Adw.ActionRow();
        modeRow.set_child(modeBox);
        this._searchGroup.add(modeRow);

        //Shared search term, with the search action as its trailing button (Enter also searches).
        this._searchEntry = new Adw.EntryRow({ title: _("Station name") });
        this._searchButton = new Gtk.Button({
            valign: Gtk.Align.CENTER,
            icon_name: "system-search-symbolic",
            tooltip_text: _("Search"),
        });
        this._searchButton.get_style_context().add_class('flat');
        this._searchEntry.add_suffix(this._searchButton);
        this._searchButton.connect('clicked', () => this.createSearchResult());
        this._searchEntry.connect('entry-activated', () => this.createSearchResult());
        this._searchGroup.add(this._searchEntry);

        //Radio-only: country (flag dropdown) + genre/tag.
        let countryModel = new Gtk.StringList();
        countryModel.append(_("Any country"));
        for (const country of COUNTRIES)
            countryModel.append(`${flagForCountryCode(country.code)}  ${country.name}`);
        this._countryRow = new Adw.ComboRow({ title: _("Country"), model: countryModel });
        this._countryRow.connect('notify::selected', () => this.createSearchResult());
        this._searchGroup.add(this._countryRow);

        this._tagEntry = new Adw.EntryRow({ title: _("Genre / tag") });
        this._tagEntry.connect('entry-activated', () => this.createSearchResult());
        this._searchGroup.add(this._tagEntry);

        //Podcast-only: PodcastIndex's search barely supports filtering beyond the term itself.
        this._cleanRow = new Adw.SwitchRow({
            title: _("Clean content only"),
            active: true,
            visible: false,
        });
        this._searchGroup.add(this._cleanRow);

        this._searchPage.add(this._searchGroup);
        this._pageReady = true;
    }

    setMode(mode) {
        this.stopPreview();
        this._mode = mode;
        let isRadio = mode === MODE_RADIO;
        this._searchEntry.title = isRadio ? _("Station name") : _("Search term");
        this._countryRow.visible = isRadio;
        this._tagEntry.visible = isRadio;
        this._cleanRow.visible = !isRadio;
        if (this.searchResults) this._searchPage.remove(this.searchResults);
        this.searchResults = null;
    }

    getSelectedCountryCode() {
        let index = this._countryRow.get_selected();
        if (index <= 0) return null; //"Any country"
        return COUNTRIES[index - 1].code;
    }

    createSearchResult() {
        //Guard against the country ComboRow firing notify::selected while the page
        //is still being built, before the user has searched for anything.
        if (!this._pageReady) return;

        let term = this._searchEntry.get_text().trim();
        let countryCode = this.getSelectedCountryCode();
        let tag = this._tagEntry.get_text().trim();
        if (this._mode === MODE_RADIO && Utils.isEmptyString(term) && Utils.isEmptyString(countryCode) && Utils.isEmptyString(tag)) return;
        if (this._mode === MODE_PODCAST && Utils.isEmptyString(term)) return;

        this.stopPreview();
        if (this.searchResults) this._searchPage.remove(this.searchResults);
        this.searchResults = new Adw.PreferencesGroup();
        this.searchResults.title = _("Search Results");
        this._searchPage.add(this.searchResults);

        if (this._mode === MODE_RADIO) this.searchRadio();
        else this.searchPodcasts();
    }

    showSearchMessage(text) {
        if (!this.searchResults) return null;
        const row = new Adw.ActionRow();
        row.title = text;
        this.searchResults.add(row);
        return row;
    }

    // ---------- Radio (radio-browser.info) ----------

    searchRadio() {
        let name = this._searchEntry.get_text().trim();
        let countryCode = this.getSelectedCountryCode();
        let tag = this._tagEntry.get_text().trim();

        //DNS resolution of the mirror hasn't come back yet; run the search as soon as it does.
        if (Utils.isEmptyString(this.server)) {
            this._pendingSearch = true;
            return;
        }

        let params = {
            limit: `${Constants.MAX_RADIO_SEARCH_RESULTS}`,
            hidebroken: "true",
            order: Constants.RADIO_BROWSER_DEFAULT_ORDER,
            reverse: "true",
        };
        if (!Utils.isEmptyString(name)) params.name = name;
        if (!Utils.isEmptyString(countryCode)) params.countrycode = countryCode;
        if (!Utils.isEmptyString(tag)) params.tag = tag;

        let message = Soup.Message.new_from_encoded_form(
            'GET',
            `https://${this.server}/json/stations/search`,
            Soup.form_encode_hash(params)
        );
        this._httpSession.send_and_read_async(
            message, GLib.PRIORITY_DEFAULT, null,
            (httpSession, result) => {
                if (message.get_status() === Soup.Status.OK) {
                    let bytes = httpSession.send_and_read_finish(result);
                    let response = new TextDecoder('utf-8').decode(bytes.get_data());
                    let jsonResponse = [];
                    try { jsonResponse = JSON.parse(response); }
                    catch (e) { console.warn(`${Constants.LOG_PREFIX_RADIO_SEARCH} Failed to parse response: [${e}]`); }

                    if (jsonResponse.length > 0) jsonResponse.forEach(station => this.addRadioRow(station));
                    else this.showSearchMessage(_("No stations found."));
                } else {
                    //This mirror returned an error (radio-browser.info mirrors occasionally go
                    //down individually); pick another one for the next search and tell the user.
                    console.warn(`${Constants.LOG_PREFIX_RADIO_SEARCH} Search request failed with status [${message.get_status()}]`);
                    this.showSearchMessage(_("Search failed, please try again."));
                    this.server = null;
                    Utils.resolveRadioBrowserServer((server) => { this.server = server; });
                }
            }
        );
    }

    addRadioRow(apiStation) {
        try {
            const act = new Adw.ActionRow();
            act.title = Utils.processSpecialCharacters(apiStation.name ?? "", true);

            let tagsShort = apiStation.tags ?? "";
            if (tagsShort.length > 50) tagsShort = tagsShort.substring(0, 50) + "...";

            let subtitle = _("Country: ") + (apiStation.country ?? "") + "\n"
                + _("Tags: ") + tagsShort + "\n"
                + _("Codec: ") + (apiStation.codec ?? "") + "\n"
                + _("Bitrate: ") + (apiStation.bitrate ?? "?") + "kb/s\n";

            act.subtitle = Utils.processSpecialCharacters(subtitle, true);

            let url = apiStation.url_resolved ?? apiStation.url;
            if (this._gstAvailable && !Utils.isEmptyString(url)) {
                const previewButton = new Gtk.Button({
                    valign: Gtk.Align.CENTER,
                    icon_name: Constants.ICON_PREVIEW_PLAY,
                    tooltip_text: _("Preview (max %d seconds)").format(Constants.PREVIEW_MAX_SECONDS),
                });
                previewButton.get_style_context().add_class("circular");
                previewButton.connect("clicked", () => this.togglePreview(url, previewButton));
                act.add_suffix(previewButton);
            }

            const addButton = this.createAddButton(() => this.addRadioChannel(apiStation));
            act.add_suffix(addButton);
            this.loadThumbnail(act, apiStation.favicon);
            this.searchResults.add(act);
        } catch (e) { console.warn(`${Constants.LOG_PREFIX_RADIO_SEARCH} ${Constants.LOG_ERROR_ADD_SEARCH_ROW} [${e}]`); }
    }
    //Lets you hear a candidate station before adding it, right from the
    //search results — capped at PREVIEW_MAX_SECONDS so a forgotten preview
    //can never keep playing in the background. Only one preview plays at a
    //time; starting another (or navigating away, see stopPreview() call
    //sites) stops whatever was previewing before.
    togglePreview(url, button) {
        if (this._previewPlayer?.isPlayingUrl(url)) { this._previewPlayer.stop(); return; }

        let start = () => {
            button.set_icon_name(Constants.ICON_PREVIEW_STOP);
            this._previewPlayer.play(url, () => button.set_icon_name(Constants.ICON_PREVIEW_PLAY));
        };
        if (this._previewPlayer) { start(); return; }
        import("./previewplayer.js").then(module => {
            this._previewPlayer = module;
            start();
        }).catch(e => console.error(`${Constants.LOG_PREFIX_RADIO_SEARCH} Failed to load previewplayer.js: [${e}]`));
    }
    stopPreview() {
        this._previewPlayer?.stop();
    }

    addRadioChannel(channel) {
        let encodedUri = Utils.processSpecialCharacters(channel.url_resolved ?? channel.url, true);
        let encodedName = Utils.processSpecialCharacters(channel.name, true);
        let id = Utils.isEmptyString(channel.stationuuid) ? Utils.uuidv4() : channel.stationuuid;

        if (this._kayraPrefs._stationsPageHandler.channelExists(encodedUri)) return false;

        if (channel.favicon && !channel.favicon.endsWith('/'))
            Utils.saveThumbnail(channel.favicon, Utils.getConfigPath() + "/" + id);

        this._kayraPrefs.channelsChanged = true;
        this._kayraPrefs._stationsPageHandler.addChannelInfo(id, encodedName, encodedUri, {
            source: Constants.CHANNEL_SOURCE_RADIOBROWSER,
            stationuuid: channel.stationuuid ?? null,
            favicon: channel.favicon ?? null,
            tags: channel.tags ?? null,
            country: channel.country ?? null,
            codec: channel.codec ?? null,
            bitrate: channel.bitrate ?? null,
            homepage: channel.homepage ?? null,
        });
        return true;
    }

    // ---------- Podcasts (podcastindex.org) ----------

    searchPodcasts() {
        let term = this._searchEntry.get_text().trim();
        PodcastIndex.searchPodcasts(term, (feeds, error) => {
            if (error) { this.showSearchMessage(error); return; }
            this._lastFeeds = feeds;
            if (feeds.length === 0) { this.showSearchMessage(_("No podcasts found.")); return; }
            feeds.forEach(feed => this.addPodcastRow(feed));
        });
    }

    addPodcastRow(feed) {
        try {
            const act = new Adw.ActionRow({ activatable: true });
            act.title = Utils.processSpecialCharacters(feed.title ?? "", true);
            act.subtitle = Utils.processSpecialCharacters(feed.author ?? "", true);
            act.connect("activated", () => this.showEpisodes(feed));

            const episodesButton = new Gtk.Button({
                valign: Gtk.Align.CENTER,
                icon_name: "view-list-symbolic",
                tooltip_text: _("Browse episodes"),
            });
            episodesButton.get_style_context().add_class('flat');
            episodesButton.connect('clicked', () => this.showEpisodes(feed));
            act.add_suffix(episodesButton);

            const addButton = this.createAddButton(() => this.addPodcastFeedChannel(feed));
            act.add_suffix(addButton);

            this.loadThumbnail(act, feed.image ?? feed.artwork);
            this.searchResults.add(act);
        } catch (e) { console.warn(`${Constants.LOG_PREFIX_RADIO_SEARCH} ${Constants.LOG_ERROR_ADD_SEARCH_ROW} [${e}]`); }
    }

    showEpisodes(feed) {
        if (this.searchResults) this._searchPage.remove(this.searchResults);
        this.searchResults = new Adw.PreferencesGroup();
        this.searchResults.title = feed.title;
        this._searchPage.add(this.searchResults);

        const backRow = new Adw.ActionRow({ activatable: true, title: "← " + _("Back to search results") });
        backRow.connect("activated", () => {
            if (this.searchResults) this._searchPage.remove(this.searchResults);
            this.searchResults = new Adw.PreferencesGroup();
            this.searchResults.title = _("Search Results");
            this._searchPage.add(this.searchResults);
            this._lastFeeds.forEach(f => this.addPodcastRow(f));
        });
        this.searchResults.add(backRow);

        let loadingRow = this.showSearchMessage(_("Loading episodes…"));
        PodcastIndex.getEpisodes(feed.id, (episodes, error) => {
            if (loadingRow) this.searchResults.remove(loadingRow);
            if (error) { this.showSearchMessage(error); return; }
            if (episodes.length === 0) { this.showSearchMessage(_("No episodes found.")); return; }
            episodes.forEach(ep => this.addEpisodeRow(feed, ep));
        });
    }

    addEpisodeRow(feed, episode) {
        try {
            const act = new Adw.ActionRow();
            act.title = Utils.processSpecialCharacters(episode.title ?? "", true);
            act.subtitle = `${this.formatEpisodeDate(episode.datePublished)} · ${this.formatDuration(episode.duration)}`;
            const addButton = this.createAddButton(() => this.addPodcastEpisodeChannel(feed, episode));
            act.add_suffix(addButton);
            this.loadThumbnail(act, episode.image ?? feed.image);
            this.searchResults.add(act);
        } catch (e) { console.warn(`${Constants.LOG_PREFIX_RADIO_SEARCH} ${Constants.LOG_ERROR_ADD_SEARCH_ROW} [${e}]`); }
    }

    addPodcastFeedChannel(feed) {
        if (this._kayraPrefs._stationsPageHandler.channelExistsById(`${feed.id}`)) return false;

        this._kayraPrefs.channelsChanged = true;
        this._kayraPrefs._stationsPageHandler.addChannelInfo(`${feed.id}`, feed.title, feed.url ?? "", {
            source: Constants.CHANNEL_SOURCE_PODCASTINDEX,
            podcastType: "feed",
            feedId: feed.id,
            feedTitle: feed.title,
            author: feed.author ?? null,
            favicon: feed.image ?? feed.artwork ?? null,
            episodeCount: feed.episodeCount ?? null,
            latestEpisodeGuid: null,
            lastSeenEpisodeGuid: null,
        });
        if (feed.image || feed.artwork) Utils.saveThumbnail(feed.image ?? feed.artwork, Utils.getConfigPath() + "/" + feed.id);
        return true;
    }

    addPodcastEpisodeChannel(feed, episode) {
        let id = Utils.isEmptyString(episode.guid) ? Utils.uuidv4() : episode.guid;
        if (this._kayraPrefs._stationsPageHandler.channelExistsById(id)) return false;

        this._kayraPrefs.channelsChanged = true;
        this._kayraPrefs._stationsPageHandler.addChannelInfo(id, episode.title, episode.enclosureUrl, {
            source: Constants.CHANNEL_SOURCE_PODCASTINDEX,
            podcastType: "episode",
            feedId: feed.id,
            feedTitle: feed.title,
            favicon: episode.image ?? feed.image ?? null,
            duration: episode.duration ?? null,
            datePublished: episode.datePublished ?? null,
        });
        let artwork = episode.image ?? feed.image;
        if (artwork) Utils.saveThumbnail(artwork, Utils.getConfigPath() + "/" + id);
        return true;
    }

    formatDuration(seconds) {
        if (Utils.isEmptyString(seconds)) return "";
        let minutes = Math.round(seconds / 60);
        return `${minutes} min`;
    }

    formatEpisodeDate(unixSeconds) {
        if (Utils.isEmptyString(unixSeconds)) return "";
        let date = GLib.DateTime.new_from_unix_local(unixSeconds);
        return date.format("%d-%m-%Y");
    }

    // ---------- Shared helpers ----------

    createAddButton(onAdd) {
        const addButton = new Gtk.Button({ valign: Gtk.Align.CENTER, icon_name: Constants.ICON_ADD_CHANNEL });
        addButton.get_style_context().add_class('circular');
        addButton.connect('clicked', () => {
            let added = onAdd();
            addButton.set_icon_name(added ? "object-select-symbolic" : Constants.ICON_ADD_CHANNEL);
            addButton.set_tooltip_text(added ? _("Added to your stations") : _("Already in your stations"));
            addButton.set_sensitive(false);
        });
        return addButton;
    }

    loadThumbnail(act, imageUrl) {
        let thumbNail = Gtk.Image.new();
        thumbNail.set_from_icon_name(Constants.ICON_CHANNEL_THUMB_PLACEHOLDER);
        thumbNail.set_pixel_size(Constants.SEARCH_PIXEL_SIZE);
        act.add_prefix(thumbNail);

        if (!imageUrl || imageUrl.endsWith('/')) return;

        //Load off the main loop so a page of results doesn't freeze the UI.
        try {
            const file = Gio.File.new_for_uri(imageUrl);
            file.load_contents_async(null, (source, result) => {
                try {
                    const [, contents] = source.load_contents_finish(result);
                    const texture = Gdk.Texture.new_from_bytes(GLib.Bytes.new(contents));
                    thumbNail.set_from_paintable(texture);
                } catch (error) {
                    console.warn(`${Constants.LOG_PREFIX_RADIO_SEARCH} ${Constants.LOG_ERROR_LOAD_THUMBNAIL}: [${imageUrl}] [${error}]`);
                }
            });
        } catch (error) {
            console.warn(`${Constants.LOG_PREFIX_RADIO_SEARCH} ${Constants.LOG_ERROR_LOAD_THUMBNAIL}: [${imageUrl}] [${error}]`);
        }
    }
}
