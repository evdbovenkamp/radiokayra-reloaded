import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import GLib from 'gi://GLib';
import Gio from "gi://Gio";
import Gdk from 'gi://Gdk';
import Soup from 'gi://Soup?version=3.0';
import * as Utils from "./utils.js";
import * as Constants from "./constants.js";
import { COUNTRIES, flagForCountryCode } from "./countries.js";
import { gettext as _, } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

export const SearchRadioPageHandler = class ChannelInfo {
    constructor(kayraPrefs) {
        this._kayraPrefs = kayraPrefs;
        this._window = kayraPrefs._window;
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
        this._httpSession = null;
    }
    createPage() {
        this._searchPage = new Adw.PreferencesPage();
        this._searchPage.title = _("Radio");
        this._searchPage.icon_name = Constants.ICON_RADIO_SEARCH_PAGE;
        this._window.add(this._searchPage);

        this._searchGroup = new Adw.PreferencesGroup();
        this._searchGroup.title = _("Search");
        this._searchGroup.description = _("Searches the radio-browser.info database of 50000+ stations. Leave fields empty to match everything.");

        //Station name, with the search action as its trailing button (Enter also searches).
        this._searchEntry = new Adw.EntryRow({ title: _("Station name") });
        this._searchButton = new Gtk.Button({
            valign: Gtk.Align.CENTER,
            icon_name: "system-search-symbolic",
            tooltip_text: _("Search"),
        });
        this._searchButton.get_style_context().add_class('flat');
        this._searchEntry.add_suffix(this._searchButton);
        this._search_button_click_handler = this._searchButton.connect('clicked', () => this.createSearchResult());
        this._search_entry_click_handler = this._searchEntry.connect('entry-activated', () => this.createSearchResult());
        this._searchGroup.add(this._searchEntry);

        //Country, picked from a list (with flags) rather than typed freely, so the
        //value always matches what radio-browser.info actually understands.
        let countryModel = new Gtk.StringList();
        countryModel.append(_("Any country"));
        for (const country of COUNTRIES)
            countryModel.append(`${flagForCountryCode(country.code)}  ${country.name}`);

        this._countryRow = new Adw.ComboRow({
            title: _("Country"),
            model: countryModel,
        });
        this._country_row_handler = this._countryRow.connect('notify::selected', () => this.createSearchResult());
        this._searchGroup.add(this._countryRow);

        //Genre / tag, e.g. "jazz", "news", "80s".
        this._tagEntry = new Adw.EntryRow({ title: _("Genre / tag") });
        this._tag_entry_click_handler = this._tagEntry.connect('entry-activated', () => this.createSearchResult());
        this._searchGroup.add(this._tagEntry);

        this._searchPage.add(this._searchGroup);
        this._pageReady = true;
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

        let name = this._searchEntry.get_text().trim();
        let countryCode = this.getSelectedCountryCode();
        let tag = this._tagEntry.get_text().trim();
        if (Utils.isEmptyString(name) && Utils.isEmptyString(countryCode) && Utils.isEmptyString(tag)) return;

        if (this.searchResults) this._searchPage.remove(this.searchResults);
        this.searchResults = new Adw.PreferencesGroup();
        this.searchResults.title = _("Search Results");
        this._searchPage.add(this.searchResults);

        this.search();
    }
    showSearchMessage(text) {
        if (!this.searchResults) return;
        const row = new Adw.ActionRow();
        row.title = text;
        this.searchResults.add(row);
    }
    search() {
        let name = this._searchEntry.get_text().trim();
        let countryCode = this.getSelectedCountryCode();
        let tag = this._tagEntry.get_text().trim();
        if (Utils.isEmptyString(name) && Utils.isEmptyString(countryCode) && Utils.isEmptyString(tag)) return;

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
                    let decoder = new TextDecoder('utf-8');
                    let response = decoder.decode(bytes.get_data());
                    let jsonResponse = [];
                    try { jsonResponse = JSON.parse(response); }
                    catch (e) { console.warn(`${Constants.LOG_PREFIX_RADIO_SEARCH} Failed to parse response: [${e}]`); }

                    if (jsonResponse.length > 0) {
                        for (let i = 0; i < jsonResponse.length; i++) {
                            this.addSearchRow(jsonResponse[i]);
                        }
                    } else {
                        console.warn(`${Constants.LOG_PREFIX_RADIO_SEARCH} ${Constants.LOG_ERROR_JSON_EMPTY}`);
                        this.showSearchMessage(_("No stations found."));
                    }
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
    addSearchRow(apiStation) {
        try {
            const act = new Adw.ActionRow();
            act.title = Utils.processSpecialCharacters(apiStation.name ?? "", true);

            let tagsShort = apiStation.tags ?? "";
            if (tagsShort.length > 50)
                tagsShort = tagsShort.substring(0, 50) + "...";

            let urlShort = apiStation.url ?? "";
            if (urlShort.length > 50)
                urlShort = urlShort.substring(0, 50) + "...";

            let subtitle = _("Country: ") + (apiStation.country ?? "") + "\n"
                + _("Tags: ") + tagsShort + "\n"
                + _("Link: ") + urlShort + "\n"
                + _("Codec: ") + (apiStation.codec ?? "") + "\n"
                + _("Bitrate: ") + (apiStation.bitrate ?? "?") + "kb/s\n";

            act.subtitle = Utils.processSpecialCharacters(subtitle, true);
            const addButton = new Gtk.Button({
                valign: Gtk.Align.CENTER,
                icon_name: Constants.ICON_ADD_CHANNEL,
            });
            addButton.get_style_context().add_class('circular');
            addButton.connect('clicked', () => {
                this._kayraPrefs.channelsChanged = true;
                let added = this.addChannel(apiStation);
                addButton.set_icon_name(added ? "object-select-symbolic" : Constants.ICON_ADD_CHANNEL);
                addButton.set_tooltip_text(added ? _("Added to your stations") : _("Already in your stations"));
                addButton.set_sensitive(false);
            });
            act.add_suffix(addButton);
            this.loadThumbnail(act, apiStation);
            this.searchResults.add(act);
        } catch (e) { console.warn(`${Constants.LOG_PREFIX_RADIO_SEARCH} ${Constants.LOG_ERROR_ADD_SEARCH_ROW} [${e}]`); }


    }
    loadThumbnail(act, apiStation) {
        let favicon = apiStation.favicon;
        let thumbNail = Gtk.Image.new();
        thumbNail.set_from_icon_name(Constants.ICON_CHANNEL_THUMB_PLACEHOLDER);
        thumbNail.set_pixel_size(Constants.SEARCH_PIXEL_SIZE);
        act.add_prefix(thumbNail);

        if (!favicon || favicon.endsWith('/')) return;

        //Load the favicon off the main loop so 30 search results don't freeze the UI.
        try {
            const file = Gio.File.new_for_uri(favicon);
            file.load_contents_async(null, (source, result) => {
                try {
                    const [, contents] = source.load_contents_finish(result);
                    const texture = Gdk.Texture.new_from_bytes(GLib.Bytes.new(contents));
                    thumbNail.set_from_paintable(texture);
                } catch (error) {
                    console.warn(`${Constants.LOG_PREFIX_RADIO_SEARCH} ${Constants.LOG_ERROR_LOAD_THUMBNAIL}: [${favicon}] [${error}]`);
                }
            });
        } catch (error) {
            console.warn(`${Constants.LOG_PREFIX_RADIO_SEARCH} ${Constants.LOG_ERROR_LOAD_THUMBNAIL}: [${favicon}] [${error}]`);
        }
    }

    addChannel(channel) {
        //Encode special characters
        let encodedUri = Utils.processSpecialCharacters(channel.url_resolved ?? channel.url, true);
        let encodedName = Utils.processSpecialCharacters(channel.name, true);
        let id = Utils.isEmptyString(channel.stationuuid) ? Utils.uuidv4() : channel.stationuuid;

        if (this._kayraPrefs._stationsPageHandler.channelExists(encodedUri)) return false; //already have this station

        if (channel.favicon && !channel.favicon.endsWith('/'))
            Utils.saveThumbnail(channel.favicon, Utils.getConfigPath() + "/" + id);

        let extraMeta = {
            source: Constants.CHANNEL_SOURCE_RADIOBROWSER,
            stationuuid: channel.stationuuid ?? null,
            favicon: channel.favicon ?? null,
            tags: channel.tags ?? null,
            country: channel.country ?? null,
            codec: channel.codec ?? null,
            bitrate: channel.bitrate ?? null,
            homepage: channel.homepage ?? null,
        };
        this._kayraPrefs._stationsPageHandler.addChannelInfo(id, encodedName, encodedUri, false, extraMeta);
        return true;
    }
}
