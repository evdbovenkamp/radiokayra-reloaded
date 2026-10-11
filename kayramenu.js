import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";

import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as Config from "resource:///org/gnome/shell/misc/config.js";

import * as Utils from "./utils.js";
import * as PodcastIndex from "./podcastindex.js";
import * as ChannelBox from "./channelbox.js";
import * as PopControls from "./popcontrols.js";
import * as PopStreamInfo from "./popstreaminfo.js";
import * as PopVolumeControl from "./popvolumecontrol.js";
import * as PopSeekControls from "./popseekcontrols.js";
import * as Channels from "./channels.js";
import * as Constants from "./constants.js";
import * as Positions from "./positions.js";
import * as MusicBrainz from "./musicbrainz.js";
import * as Chromecast from "./chromecast.js";
import * as PopCastPicker from "./popcastpicker.js";
import * as KayraSearchProvider from "./searchProvider.js";

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

let radiokayraPanel;

//Used in place of RadioKayra.RadioPlayer when GStreamer isn't installed, so
//every other part of the panel (volume slider, controls, stream info) can
//keep calling the same player interface without needing its own null-checks.
//extension.js already shows a clear notification about this once at enable()
//time, so these methods just no-op rather than notifying again on every click.
const NullRadioPlayer = class NullRadioPlayer {
  isSourceReady() { return false; }
  changeChannel(_uri) { }
  play() { }
  stop() { }
  setVolume(_value) { }
  disconnectSourceBus() { }
  isPlaying() { return false; }
  setOnError(_cb) { }
  setOnStreamStarted(_cb) { }
  setOnStreamEnded(_cb) { }
  setOnTagChanged(_cb) { }
  setOnReadyToSeek(_cb) { }
  getPosition() { return null; }
  getDuration() { return null; }
  isSeekable() { return false; }
  seekTo(_seconds) { }
  seekBy(_deltaSeconds) { }
};

//A stable facade over a swappable player implementation. VolumeControlPopup,
//StreamInfoPopup etc. each capture `this._player` once, at construction time
//— if we ever reassigned `this._player` to a new object later (e.g. once the
//dynamic import of radiokayra.js resolves), every one of those captured
//references would keep pointing at the discarded old object forever. Instead
//we create exactly one PlayerProxy up front and only ever swap *its*
//internal delegate, so every holder of "the player" transparently keeps
//acting on whichever implementation is current.
const PlayerProxy = class PlayerProxy {
  constructor(delegate) { this._delegate = delegate; }
  setDelegate(delegate) { this._delegate = delegate; }
  isSourceReady() { return this._delegate.isSourceReady(); }
  changeChannel(uri) { return this._delegate.changeChannel(uri); }
  play() { return this._delegate.play(); }
  stop() { return this._delegate.stop(); }
  setVolume(value) { return this._delegate.setVolume(value); }
  disconnectSourceBus() { return this._delegate.disconnectSourceBus(); }
  isPlaying() { return this._delegate.isPlaying(); }
  setOnError(cb) { return this._delegate.setOnError(cb); }
  setOnStreamStarted(cb) { return this._delegate.setOnStreamStarted(cb); }
  setOnStreamEnded(cb) { return this._delegate.setOnStreamEnded(cb); }
  setOnTagChanged(cb) { return this._delegate.setOnTagChanged(cb); }
  setOnReadyToSeek(cb) { return this._delegate.setOnReadyToSeek(cb); }
  getPosition() { return this._delegate.getPosition(); }
  getDuration() { return this._delegate.getDuration(); }
  isSeekable() { return this._delegate.isSeekable(); }
  seekTo(seconds) { return this._delegate.seekTo(seconds); }
  seekBy(deltaSeconds) { return this._delegate.seekBy(deltaSeconds); }
};

export const RadiokayraMenuButton = GObject.registerClass(
    {
        GTypeName: "RadiokayraMenuButton",
    },
    class RadiokayraMenuButton extends PanelMenu.Button {
        destroy() {
            if (this._player.isPlaying()) this.saveCurrentPositionNow();
            this.stopPositionPoll();
            MusicBrainz.reset();
            Chromecast.reset();
            this._player.stop();
            this._player.disconnectSourceBus();

            this._settings.disconnect(this._settings_changed_handler);
            this._settings.disconnect(this._height_changed_handler);
            this._settings.disconnect(this._search_event_handler);
            this._settings.disconnect(this._chromecast_enabled_changed_handler);
            this._settingsMenuItem.disconnect(this._settings_menu_activate_handler);
            this.disconnect(this._icon_mouse_click_handler);

            this.setTrayIconStopped();

            //Don't manually destroy controlsPopup/volumeControlPopup/streamInfoPopup/
            //settingsMenuItem/channelSection/scrollViewMenuSection/channelScrollView here:
            //they're all children of this.menu, and GNOME Shell's PanelMenu.Button
            //already destroys this.menu (and everything in it, recursively) when
            //super.destroy() below triggers the actor's 'destroy' signal. Destroying
            //them a second time here just produces "already disposed" warnings.
            this._controlsPopup = null;
            this._volumeControlPopup = null;
            this._streamInfoPopup = null;
            this._seekControlsPopup = null;
            this._castMenuItem = null;
            this._settingsMenuItem = null;
            this._channelSection = null;
            this._scrollViewMenuSection = null;
            this._channelScrollView = null;

            //The tooltip is parented onto Main.layoutManager's chrome layer, not onto
            //this actor or its menu, so nothing else will clean it up for us.
            this._tooltip?.destroy();
            this._tooltip = null;

            if (this._provider !== null) {
                Main.overview.searchController.removeProvider(this._provider);
                this._provider = null;
            }

            super.destroy();
        }
        setTrayIconStopped() {
            this._trayIcon.set_gicon(this._iconStopped);
        }
        setTrayIconPlaying() {
            this._trayIcon.set_gicon(this._iconPlaying);
        }
        openPreferences() {
            this._kayraExtension.openPreferences();
        }
        
        _init(extension, gstAvailable) {
            super._init(0.0, "RadiokayraMenuButton");
            radiokayraPanel = this;
            this._shellVersion = this.getShellversion();
            //console.log("SHELL VERSION:" + this._shellVersion);
            this._kayraExtension = extension;
            this._settings = extension.getSettings();
            this._path = extension.path;
            this._activeChannel = null;
            this._currentStreamUrl = null;
            this._castingDeviceUuid = null;
            this._castingDeviceName = null;

            Chromecast.init(this._path);
            Chromecast.setOnStatusChanged((state, title) => {
                if (!radiokayraPanel._castingDeviceUuid) return;
                if (state === "IDLE") { radiokayraPanel._castingDeviceUuid = null; radiokayraPanel._castingDeviceName = null; return; }
                if (!Utils.isEmptyString(title)) radiokayraPanel._streamInfoPopup.onNewTag("", title);
            });

            let volume = this._settings.get_double(Constants.SCHEMA_VOLUME_LEVEL);

            //Always start with a safe no-op delegate so nothing else here needs
            //its own null-checks; this._player itself is the stable PlayerProxy
            //every widget below captures — only its delegate gets swapped once
            //the real player loads, never this._player itself.
            this._player = new PlayerProxy(new NullRadioPlayer());
            if (gstAvailable) {
                import("./radiokayra.js").then(RadioKayra => {
                    this._player.setDelegate(new RadioKayra.RadioPlayer(volume));
                    this.initRadioCallbacks();
                }).catch(e => {
                    console.error(`${Constants.LOG_PREFIX_EXTENSION} Failed to load radiokayra.js: [${e}]`);
                });
            }

            //REFRESH CHANNELS EVENT
            this._settings_changed_handler = this._settings.connect("changed::" + Constants.SCHEMA_CHANNELS_CHANGE_EVENT, () => {
                console.info(`EXT: ${Constants.LOG_PREFIX_EXTENSION} ${Constants.LOG_INFO_CHANNELS_JSON_CHANGED}`);
                this._channelSection.removeAll();                
                this.addChannels();
            });
            //REFRESH CHANNELS EVENT            

            this._iconStopped = Gio.icon_new_for_string(this._path + Constants.ICON_RADIO_OFF_PATH);
            this._iconPlaying = Gio.icon_new_for_string(this._path + Constants.ICON_RADIO_ON_PATH);

            this._trayIcon = new St.Icon({
                gicon: this._iconStopped,
                style_class: "system-status-icon",
            });
            this._tooltip = new St.Label({ style_class: 'song-info-panel-tooltip' });
            this.label_actor = this._tooltip;
            Main.layoutManager.addChrome(this._tooltip);            
            
            this.add_child(this._trayIcon);
            
            this.initRadioCallbacks();

            //Controls Section
            this._controlsPopup = new PopControls.ControlsPopup(this._shellVersion);
            this.menu.addMenuItem(this._controlsPopup);
            //console.error(`MY WIDTH IS ${this.get_style()}`);
            //Controls Section END            

            //Volume Section
            this._volumeControlPopup = new PopVolumeControl.VolumeControlPopup(this._player, this._settings, this._shellVersion);
            this.menu.addMenuItem(this._volumeControlPopup);            
            //Volume Section END

            //Stream Info Section
            this._streamInfoPopup = new PopStreamInfo.StreamInfoPopup(this._player, this._path, this._shellVersion);
            this.menu.addMenuItem(this._streamInfoPopup);
            //Stream Info Section END

            //Seek Controls Section (podcast episodes only; hidden for radio)
            this._seekControlsPopup = new PopSeekControls.SeekControlsPopup(this._shellVersion);
            this._seekControlsPopup.setOnSeekBack(() => this._player.seekBy(-Constants.SEEK_BACK_SECONDS));
            this._seekControlsPopup.setOnSeekForward(() => this._player.seekBy(Constants.SEEK_FORWARD_SECONDS));
            this._seekControlsPopup.setOnSeekDrag((seconds) => this._player.seekTo(seconds));
            this._seekControlsPopup.setOnPrevEpisode(() => this.navigateEpisode(1));
            this._seekControlsPopup.setOnNextEpisode(() => this.navigateEpisode(-1));
            this.menu.addMenuItem(this._seekControlsPopup);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            //Seek Controls Section END

            //Cast Section — optional, requires python3-pychromecast. Hidden
            //entirely when the Settings toggle is off or the dependency isn't
            //installed (see Settings for install instructions); the base
            //radio/podcast experience never depends on this. Opens a
            //dedicated device-picker dialog rather than a nested submenu —
            //bigger, clearer, and doesn't depend on in-menu submenu toggling.
            this._castMenuItem = new PopupMenu.PopupImageMenuItem(_("Cast to…"), Gio.icon_new_for_string(this._path + Constants.ICON_CAST_PATH));
            this._castMenuItem.visible = false;
            this._castMenuItem.connect("activate", () => this.openCastPicker());
            this.menu.addMenuItem(this._castMenuItem);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this.updateCastMenuVisibility();
            this._chromecast_enabled_changed_handler = this._settings.connect("changed::" + Constants.SCHEMA_CHROMECAST_ENABLED, () => {
                this.updateCastMenuVisibility();
            });
            //Cast Section END

            this._tooltip.text = "";

            this.hideTooltip();
            this.connect("enter-event", (_widget) => {
                this.showTooltip();
            });
            this.connect("leave-event", (_widget) => {
                this.hideTooltip();
            });

            //Channels Header Section
            this._settingsMenuItem = new PopupMenu.PopupImageMenuItem(
                _("Settings"),
                Constants.ICON_SETTINGS,
                {
                    style_class: Constants.CSS_SETTINGS_POPUP,
                },
            );
            this._settings_menu_activate_handler = this._settingsMenuItem.connect("activate", () => { radiokayraPanel.openPreferences(); });
            this.menu.addMenuItem(this._settingsMenuItem);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            //Channels Edit Section END
            
            //Channels Section
            this._channelSection = new PopupMenu.PopupMenuSection();
            this._scrollViewMenuSection = new PopupMenu.PopupMenuSection();

            this._channelScrollView = new St.ScrollView({ overlay_scrollbars: true, });

            this._channelScrollView.add_child(this._channelSection.actor);
            let newHeight = radiokayraPanel._settings.get_int(Constants.SCHEMA_PANEL_HEIGHT);
            this._channelScrollView.set_height(newHeight);
            
            //PANEL HEIGHT EVENT            
            this._height_changed_handler = this._settings.connect("changed::" + Constants.SCHEMA_PANEL_HEIGHT, () => {                
                newHeight = radiokayraPanel._settings.get_int(Constants.SCHEMA_PANEL_HEIGHT);
                this._channelScrollView.set_height(newHeight);
            });
            //PANEL HEIGHT EVENT

            this._scrollViewMenuSection.actor.add_child(this._channelScrollView);            
            this.menu.addMenuItem(this._scrollViewMenuSection);
            this.addChannels();
            
            //If there is no previously played channel, pick the first one on the list (if any)
            if (this._activeChannel === null && this.channelBoxList !== null && this.channelBoxList.length > 0)
                this._activeChannel = this.channelBoxList[0];


            //Channels Section END
            this._controlsPopup.setOnPlayClicked(this.onPlayClicked);
            this._controlsPopup.setOnPlayPrevClicked(this.onPlayPrevClicked);
            this._controlsPopup.setOnPlayNextClicked(this.onPlayNextClicked);

            //Menu Icon mouse clicks
            this._icon_mouse_click_handler = this.connect('button-press-event', (actor, event) => {
                if (event.get_button() === 2 && radiokayraPanel._activeChannel !== null) { //Middle click
                    this.menu.close();
                    radiokayraPanel.onPlayClicked();
                }
                else if (event.get_button() === 3) { //Right click
                    this.menu.close();                    
                    if (radiokayraPanel._settings.get_boolean(Constants.SCHEMA_RIGHTCLICK_SETTINGS)) 
                        radiokayraPanel.openPreferences();
                    if (radiokayraPanel._settings.get_boolean(Constants.SCHEMA_RIGHTCLICK_COPYSONG)) {
                        let song = radiokayraPanel._streamInfoPopup._artist;
                        if (!Utils.isEmptyString(song)) song += " ";                        
                        song += radiokayraPanel._streamInfoPopup._title;                        
                        
                        if (!Utils.isEmptyString(song))
                            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, song);
                    }                     
                }
            });

            this._provider = null;
            if (radiokayraPanel._settings.get_boolean(Constants.SCHEMA_GNOME_SEARCH)) 
            {                
                this._provider = new KayraSearchProvider.SearchProvider(extension, this);
                Main.overview.searchController.addProvider(this._provider);
            }  
            
            this._search_event_handler = this._settings.connect("changed::" + Constants.SCHEMA_GNOME_SEARCH, () => {                
                let bSearch = radiokayraPanel._settings.get_boolean(Constants.SCHEMA_GNOME_SEARCH);
                console.error("GNOME SEARCH:" + bSearch);
                if (bSearch) {
                    if (this._provider !== null) {
                        Main.overview.searchController.removeProvider(this._provider);                                               
                    }
                    this._provider = new KayraSearchProvider.SearchProvider(extension, this); 
                    Main.overview.searchController.addProvider(this._provider);
                }
                else {
                    Main.overview.searchController.removeProvider(this._provider);
                    this._provider = null;
                }                                    
            });
            
            this.stateReady();
            this.setTrayIconStopped();
        }
        addChannels() {
            let channelsReadWrite = new Channels.ChannelsReadWrite(radiokayraPanel._path);
            let channels = channelsReadWrite.getChannels();
            let lastPlayedId = radiokayraPanel._settings.get_string(Constants.SCHEMA_LAST_PLAYED);
            this.channelBoxList = [];

            for (let i = 0; i < channels.length; ++i) {
                let channelData = channels[i];
                let channelInfo = new Channels.ChannelInfo(
                    channelData.id,
                    channelData.name,
                    channelData.uri,
                    channelData.order,
                    channelData
                );
                let channelBox = new ChannelBox.ChannelBox(channelInfo, this);
                this.channelBoxList.push(channelBox);
                this._addToChannelSection(channelBox);
                if (!Utils.isEmptyString(lastPlayedId) &&
                    lastPlayedId === channelInfo.getId()) {
                    radiokayraPanel._activeChannel = channelBox;
                    channelBox.setActive(true);
                    this._streamInfoPopup.setChannelName(channelInfo.getName());
                    this._streamInfoPopup.showThumbnail(channelBox);
                }
            }
        }
        _addToChannelSection(channelBox) {            
            this._channelSection.addMenuItem(channelBox);
        }
        enable() {

        }

        initRadioCallbacks() {
            this._player.setOnError((type, message) => { this.onPlayerError(type, message); });
            this._player.setOnStreamStarted(() => { this.onPlayerStreamStarted(); });
            this._player.setOnStreamEnded(() => { this.onPlayerStreamEnded(); });
            this._player.setOnTagChanged((artist, title) => { this.onPlayerTagChanged(artist, title); });
            this._player.setOnReadyToSeek(() => { this.onPlayerReadyToSeek(); });
        }
        //Fires once the pipeline can actually be queried/seeked for the episode
        //that just started; the right moment to apply a saved resume position.
        onPlayerReadyToSeek() {
            let info = radiokayraPanel._activeChannel?._channelInfo;
            if (!info || info.source !== Constants.CHANNEL_SOURCE_PODCASTINDEX) return;
            let guid = radiokayraPanel._currentEpisodeGuid;
            if (!guid) return;

            let syncFolder = radiokayraPanel._settings.get_string(Constants.SCHEMA_SYNC_FOLDER);
            Positions.getPosition(info.id, syncFolder, (saved) => {
                if (!saved || saved.guid !== guid) return; //resuming into a different episode would be wrong
                let duration = radiokayraPanel._player.getDuration();
                if (duration === null) return;
                if (saved.position < Constants.RESUME_EDGE_MARGIN_SECONDS) return; //pointless this close to the start
                if (saved.position > duration - Constants.RESUME_EDGE_MARGIN_SECONDS) return; //it'd end immediately
                radiokayraPanel._player.seekTo(saved.position);
            });
        }
        onPlayerStreamStarted() {
            if (radiokayraPanel._activeChannel === null) {
                console.warn("Active Channel is null. This shouldn't happen.")
                return;
            }
            radiokayraPanel.setTrayIconPlaying();            
            radiokayraPanel._controlsPopup.statePlaying();
            radiokayraPanel._streamInfoPopup.statePlaying(radiokayraPanel._activeChannel);
            radiokayraPanel._player.setVolume(radiokayraPanel._volumeControlPopup.getVolume());

            let playingChannelInfo = radiokayraPanel._activeChannel._channelInfo;
            if (playingChannelInfo.getSource() === Constants.CHANNEL_SOURCE_RADIOBROWSER)
                Utils.registerRadioBrowserClick(playingChannelInfo.getStationUuid());

            radiokayraPanel._seekControlsPopup.setEpisodeNavEnabled(!!radiokayraPanel._currentFeedId);
            radiokayraPanel.startPositionPoll();
            console.info("STREAM STARTED");
        }
        onPlayerStreamEnded() {
            radiokayraPanel.setTrayIconStopped();
            radiokayraPanel.stateReady();
            radiokayraPanel.stopPositionPoll();
            radiokayraPanel._seekControlsPopup.hideForRadio();
            //Natural end of episode: nothing meaningful to resume into.
            radiokayraPanel.clearCurrentPosition();
        }
        //--- Playback position: polling, saving, resuming ---
        startPositionPoll() {
            this.stopPositionPoll();
            this._positionTickCount = 0;
            this._positionPollSourceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, Constants.POSITION_POLL_INTERVAL_SECONDS, () => {
                this.onPositionTick();
                return GLib.SOURCE_CONTINUE;
            });
        }
        stopPositionPoll() {
            if (this._positionPollSourceId) {
                GLib.source_remove(this._positionPollSourceId);
                this._positionPollSourceId = null;
            }
        }
        onPositionTick() {
            if (!radiokayraPanel._player.isPlaying()) return;
            let info = radiokayraPanel._activeChannel?._channelInfo;
            let isPodcast = info?.source === Constants.CHANNEL_SOURCE_PODCASTINDEX;
            let position = radiokayraPanel._player.getPosition();
            let duration = radiokayraPanel._player.getDuration();

            if (isPodcast && duration !== null) {
                radiokayraPanel._seekControlsPopup.showForEpisode();
                radiokayraPanel._seekControlsPopup.updateProgress(position, duration);
            } else radiokayraPanel._seekControlsPopup.hideForRadio();

            radiokayraPanel._positionTickCount++;
            if (isPodcast && position !== null && radiokayraPanel._positionTickCount % Constants.POSITION_SAVE_INTERVAL_SECONDS === 0)
                radiokayraPanel.saveCurrentPositionNow(position);
        }
        saveCurrentPositionNow(position) {
            let info = radiokayraPanel._activeChannel?._channelInfo;
            if (!info || info.source !== Constants.CHANNEL_SOURCE_PODCASTINDEX) return;
            let guid = radiokayraPanel._currentEpisodeGuid;
            if (!guid) return;
            if (position === undefined) position = radiokayraPanel._player.getPosition();
            if (position === null) return;
            let syncFolder = radiokayraPanel._settings.get_string(Constants.SCHEMA_SYNC_FOLDER);
            Positions.savePosition(info.id, guid, position, syncFolder);
        }
        clearCurrentPosition() {
            let info = radiokayraPanel._activeChannel?._channelInfo;
            if (!info || info.source !== Constants.CHANNEL_SOURCE_PODCASTINDEX) return;
            let syncFolder = radiokayraPanel._settings.get_string(Constants.SCHEMA_SYNC_FOLDER);
            Positions.clearPosition(info.id, syncFolder);
        }
        onPlayerError(type, message) { console.warn(`${Constants.LOG_PREFIX_EXTENSION} ${Constants.LOG_PLAYER_ERROR} [${type}] [${message}]`); }
        //Some stations/podcast CDNs resend the exact same TAG message
        //continuously (observed: hundreds of times in a row with an
        //unchanging placeholder title). Every downstream step here — label
        //text updates, tooltip text layout, a notification — costs real time
        //on gnome-shell's single UI thread; at a high enough repeat rate that
        //alone can make the whole desktop feel frozen, not just this
        //extension. So bail out immediately, before doing *any* work, unless
        //the content actually changed since the last message.
        onPlayerTagChanged(artist, title) {
            let key = `${artist}\u0000${title}`;
            if (key === radiokayraPanel._lastTagKey) return;
            radiokayraPanel._lastTagKey = key;

            radiokayraPanel._streamInfoPopup.onNewTag(artist, title);
            radiokayraPanel.updateToolTip();
            radiokayraPanel.lookupCoverArt(artist, title, key);
        }
        //Cover art enrichment, default on (SCHEMA_ENRICH_TRACK_DATA), radio
        //stations only — podcasts already carry their own artwork. Reads the
        //toggle live so Settings takes effect without a logout. The track
        //notification (if enabled) waits for this to resolve so it can carry
        //the cover art too, rather than firing immediately without it.
        lookupCoverArt(artist, title, requestKey) {
            radiokayraPanel._streamInfoPopup.clearCoverArt();
            let source = radiokayraPanel._activeChannel?._channelInfo?.source;
            let canEnrich = source !== Constants.CHANNEL_SOURCE_PODCASTINDEX
                && radiokayraPanel._settings.get_boolean(Constants.SCHEMA_ENRICH_TRACK_DATA);
            if (!canEnrich) { radiokayraPanel.notifyNewTrack(artist, title, null); return; }

            MusicBrainz.lookupCoverArt(artist, title, (bytes) => {
                //The track (or the channel) may have moved on while this lookup
                //was queued/in flight — never paint stale art, or notify about
                //a track that already passed.
                if (radiokayraPanel._lastTagKey !== requestKey) return;
                if (bytes) radiokayraPanel._streamInfoPopup.showCoverArt(bytes);
                radiokayraPanel.notifyNewTrack(artist, title, bytes);
            });
        }
        //Desktop notification, if enabled — onPlayerTagChanged above already
        //guarantees this only runs once per genuinely new tag. coverBytes is
        //the enriched cover art (or null/undefined), shown as the
        //notification's icon when available.
        notifyNewTrack(artist, title, coverBytes = null) {
            if (!radiokayraPanel._settings.get_boolean(Constants.SCHEMA_SONG_NOTIFICATION)) return;
            if (Utils.isEmptyString(artist) && Utils.isEmptyString(title)) return;

            let channelName = radiokayraPanel._activeChannel?._channelInfo?.getName() ?? "";
            let body = [artist, title].filter(part => !Utils.isEmptyString(part)).join(" – ");

            if (!coverBytes) { Main.notify(channelName, body); return; }

            let source = MessageTray.getSystemSource();
            let notification = new MessageTray.Notification({
                source,
                title: channelName,
                body,
                gicon: Gio.BytesIcon.new(coverBytes),
                isTransient: true,
            });
            source.addNotification(notification);
        }
        onChannelChanged(channel) {
            if (radiokayraPanel._activeChannel === null) console.info(`${Constants.LOG_PREFIX_EXTENSION} ${Constants.LOG_INFO_CHANNEL_CHANGED}:[] -> [${channel._channelInfo.getId()}]`);
            else {
                console.info(`${Constants.LOG_PREFIX_EXTENSION} ${Constants.LOG_INFO_CHANNEL_CHANGED}:[${radiokayraPanel._activeChannel._channelInfo.getId()}] -> [${channel._channelInfo.getId()}]`);
                radiokayraPanel._activeChannel.setActive(false);
            }

            if (radiokayraPanel._player.isPlaying()) {
                radiokayraPanel.saveCurrentPositionNow();
                this._player.stop();
            }
            radiokayraPanel.stopPositionPoll();

            radiokayraPanel._activeChannel = channel;
            radiokayraPanel._activeChannel.setActive(true);
            radiokayraPanel._currentEpisodeGuid = null;
            radiokayraPanel._currentFeedId = null;
            radiokayraPanel._episodeListCache = null;
            radiokayraPanel._seekControlsPopup.hideForRadio();

            radiokayraPanel.stateReady();
            radiokayraPanel.stateLoadingChannel();
            radiokayraPanel.playResolvedUrl();
        }
        onPlayClicked() {
            if (radiokayraPanel._activeChannel === null) return; //"Play Clicked: No active channels!"

            if (radiokayraPanel._player.isPlaying()) { //Stop if playing
                radiokayraPanel.saveCurrentPositionNow();
                radiokayraPanel.stopPositionPoll();
                radiokayraPanel._player.stop();
                radiokayraPanel.stateReady();
                radiokayraPanel.setTrayIconStopped();
            } else { //Play if stopped
                radiokayraPanel.stateLoadingChannel();
                if (radiokayraPanel._player.isSourceReady()) //Already playing this channel before. Continue.
                    radiokayraPanel._player.play();
                else //First time play is clicked. It plays last played channel.
                    radiokayraPanel.playResolvedUrl();
            }
        }
        onPlayNextClicked() {            
            radiokayraPanel._navigateChannel(radiokayraPanel.findNextChannelBox());
                     
        }
        onPlayPrevClicked() {
            radiokayraPanel._navigateChannel(radiokayraPanel.findPrevChannelBox());
        }
        _navigateChannel(channel) {
            let activeChannel = radiokayraPanel._activeChannel;
            if (channel === null) {
                console.info(`${Constants.LOG_PREFIX_EXTENSION} ${Constants.LOG_INFO_CHANNEL_NAVIGATE}:[Fail]`);  
                return; 
            }
            if (activeChannel === null) {
                console.warn(`${Constants.LOG_PREFIX_EXTENSION} ${Constants.LOG_INFO_CHANNEL_NAVIGATE}:[Active channel not found]`);              
            }                
            else {
                if (channel._channelInfo.getId() === activeChannel._channelInfo.getId()) { 
                    //Probably just 1 channel in the list. Don't switch.
                    console.warn(`${Constants.LOG_PREFIX_EXTENSION} ${Constants.LOG_INFO_CHANNEL_NAVIGATE}:[ID is the same ${activeChannel._channelInfo.getId()}]`);                              
                    return;
                }
                else {
                    //More than 1 channels, everything is fine.
                    console.warn(`${Constants.LOG_PREFIX_EXTENSION} ${Constants.LOG_INFO_CHANNEL_NAVIGATE}:[Active channel: ${activeChannel._channelInfo.getName()}]`);            
                }                
            }                            
            console.warn(`${Constants.LOG_PREFIX_EXTENSION} ${Constants.LOG_INFO_CHANNEL_NAVIGATE}:[Switching to: ${channel._channelInfo.getName()}]`);              
            radiokayraPanel.onChannelChanged(channel);   
        }
        playResolvedUrl() {
            let channelBox = radiokayraPanel._activeChannel;
            let info = channelBox._channelInfo;

            if (info.source === Constants.CHANNEL_SOURCE_PODCASTINDEX && info.podcastType === "feed") {
                radiokayraPanel._currentFeedId = info.feedId;
                PodcastIndex.getLatestEpisode(info.feedId, (episode, error) => {
                    //The user may have clicked another channel while this was in flight.
                    if (radiokayraPanel._activeChannel !== channelBox) return;
                    if (error || !episode) {
                        console.warn(`${Constants.LOG_PREFIX_EXTENSION} PodcastIndex error:[${error}]`);
                        Main.notify('PodcastIndex.org', error ?? "Unknown error");
                        return;
                    }
                    channelBox.clearNewEpisodeBadge(episode.guid);
                    radiokayraPanel.persistEpisodeSeen(info.id, episode.guid);
                    radiokayraPanel._currentEpisodeGuid = episode.guid;
                    radiokayraPanel.playUrl(episode.enclosureUrl);
                });
                return;
            }

            if (info.source === Constants.CHANNEL_SOURCE_PODCASTINDEX && info.podcastType === "episode") {
                radiokayraPanel._currentEpisodeGuid = info.id; //id === guid for standalone episode channels
                radiokayraPanel._currentFeedId = info.feedId ?? null;
            }

            radiokayraPanel.playUrl(info.getUri());
        }
        playUrl(url) {
            url = Utils.processSpecialCharacters(url, false);
            radiokayraPanel._currentStreamUrl = url;
            //While actively casting, a channel/episode switch follows the cast
            //device instead of local playback — otherwise both would play at
            //once, out of sync. castCurrentStreamTo() keeps the existing
            //session going; local audio stays stopped until "Stop casting".
            if (radiokayraPanel._castingDeviceUuid) {
                radiokayraPanel.castCurrentStreamTo(radiokayraPanel._castingDeviceUuid, radiokayraPanel._castingDeviceName);
                return;
            }
            radiokayraPanel._player.changeChannel(url);
            radiokayraPanel._player.play();
        }
        //Optional extra on top of the base radio/podcast experience — see
        //updateCastMenuVisibility() for the availability/Settings gate.
        //Casts the current stream's own URL directly to the device; the
        //device fetches it itself (same as any Cast-compatible receiver),
        //nothing is relayed through this machine.
        updateCastMenuVisibility() {
            if (!this._settings.get_boolean(Constants.SCHEMA_CHROMECAST_ENABLED)) {
                this._castMenuItem.visible = false;
                return;
            }
            Chromecast.isAvailable((available) => { this._castMenuItem.visible = available; });
        }
        openCastPicker() {
            let dialog = new PopCastPicker.CastPickerDialog(
                radiokayraPanel._castingDeviceName,
                (uuid, name) => radiokayraPanel.castCurrentStreamTo(uuid, name),
                () => radiokayraPanel.stopCasting(),
            );
            let closed = false;
            dialog.connect("destroy", () => { closed = true; });
            dialog.open();
            Chromecast.discoverDevices((devices) => {
                if (closed) return; //cancelled/closed before discovery resolved
                dialog.showDevices(devices);
            });
        }
        castCurrentStreamTo(uuid, deviceName) {
            let url = radiokayraPanel._currentStreamUrl;
            if (!url) return;
            let alreadyCasting = radiokayraPanel._castingDeviceUuid !== null;
            radiokayraPanel._castingDeviceUuid = uuid;
            radiokayraPanel._castingDeviceName = deviceName;
            let title = radiokayraPanel._activeChannel?._channelInfo?.getName() ?? "";

            Chromecast.castUrl(uuid, url, "audio/mpeg", title, (success, error) => {
                if (!success) {
                    Main.notify(_("Cast"), error ? `${_("Could not cast")}: ${error}` : _("Could not cast"));
                    radiokayraPanel._castingDeviceUuid = null;
                    radiokayraPanel._castingDeviceName = null;
                    return;
                }
                if (!alreadyCasting && radiokayraPanel._player.isPlaying()) radiokayraPanel._player.stop();
                radiokayraPanel.stateReady();
                Main.notify(_("Cast"), _("Casting to %s").format(deviceName));
            });
        }
        stopCasting() {
            Chromecast.stopCasting(() => {
                radiokayraPanel._castingDeviceUuid = null;
                radiokayraPanel._castingDeviceName = null;
                if (radiokayraPanel._currentStreamUrl) {
                    radiokayraPanel._player.changeChannel(radiokayraPanel._currentStreamUrl);
                    radiokayraPanel._player.play();
                }
            });
        }
        //direction: +1 = older (previous), -1 = newer (next). Episode lists
        //come back newest-first, so "older" means a higher array index.
        //Navigating doesn't touch channels.json — it's the same active channel
        //slot, just loaded with a different episode, exactly like what a
        //"feed" channel already does for its latest episode on every play.
        navigateEpisode(direction) {
            let channelBox = radiokayraPanel._activeChannel;
            let info = channelBox?._channelInfo;
            if (!info || info.source !== Constants.CHANNEL_SOURCE_PODCASTINDEX) return;
            let feedId = radiokayraPanel._currentFeedId;
            if (!feedId) return;

            let proceed = (episodes) => {
                if (radiokayraPanel._activeChannel !== channelBox) return; //switched away while fetching
                let currentIndex = episodes.findIndex(e => e.guid === radiokayraPanel._currentEpisodeGuid);
                let newIndex = (currentIndex === -1 ? 0 : currentIndex) + direction;
                if (newIndex < 0 || newIndex >= episodes.length) return; //no more episodes that way

                let episode = episodes[newIndex];
                if (radiokayraPanel._player.isPlaying()) radiokayraPanel.saveCurrentPositionNow();
                radiokayraPanel._currentEpisodeGuid = episode.guid;
                radiokayraPanel._streamInfoPopup.setChannelName(episode.title);
                radiokayraPanel.stateLoadingChannel();
                if (radiokayraPanel._player.isPlaying()) radiokayraPanel._player.stop();
                radiokayraPanel.playUrl(episode.enclosureUrl);
            };

            let cache = radiokayraPanel._episodeListCache;
            if (cache && cache.feedId === feedId) { proceed(cache.episodes); return; }
            PodcastIndex.getEpisodes(feedId, (episodes, error) => {
                if (error) { Main.notify('PodcastIndex.org', error); return; }
                radiokayraPanel._episodeListCache = { feedId, episodes };
                proceed(episodes);
            });
        }
        //Persists a podcast feed's latest-seen episode straight to channels.json
        //(prefs writes the same file; there's no other IPC between the two).
        persistEpisodeSeen(channelId, episodeGuid) {
            let channelsReadWrite = new Channels.ChannelsReadWrite(radiokayraPanel._path);
            let channels = channelsReadWrite.getChannels();
            let channel = channels.find(c => c.id === channelId);
            if (!channel) return;
            channel.latestEpisodeGuid = episodeGuid;
            channel.lastSeenEpisodeGuid = episodeGuid;
            channelsReadWrite.writeChannelsFile(channels);
        }
        stateReady() {
            radiokayraPanel._controlsPopup.stateReady();            
            radiokayraPanel._streamInfoPopup.resetTags();
        }
        stateLoadingChannel() {
            radiokayraPanel._streamInfoPopup.stateLoading();
            radiokayraPanel._streamInfoPopup.clearCoverArt();
            radiokayraPanel._controlsPopup.stateLoading();
            radiokayraPanel._lastTagKey = null;
            console.info("Playing Link:[" + radiokayraPanel._activeChannel._channelInfo.getUri() + "]");
            radiokayraPanel._settings.set_string(
                Constants.SCHEMA_LAST_PLAYED,
                radiokayraPanel._activeChannel._channelInfo.getId(),
            );
        }
        findChannelBox(id) {
            for (let i = 0; i < this.channelBoxList.length; ++i) {
                let channelBox = this.channelBoxList[i];
                if (channelBox._channelInfo.id === id) return channelBox;
            }
            return null;
        }
        findPrevChannelBox() {          
            if (radiokayraPanel.channelBoxList.length === 0 || radiokayraPanel._activeChannel === null)
                return null;    
            let activeChannelInfo = radiokayraPanel._activeChannel._channelInfo;
            //console.error(`Active channel order ${activeChannelInfo.getOrder()}`);        

            for (let i = radiokayraPanel.channelBoxList.length - 1; i >= 0; --i) {
                let channelBox = radiokayraPanel.channelBoxList[i];                
                if (channelBox._channelInfo.getOrder() < activeChannelInfo.getOrder()) return channelBox;                
            }
            return radiokayraPanel.channelBoxList[radiokayraPanel.channelBoxList.length - 1];
        }
        findNextChannelBox() {                          
            if (radiokayraPanel.channelBoxList.length === 0 || radiokayraPanel._activeChannel === null)
                return null;    
            let activeChannelInfo = radiokayraPanel._activeChannel._channelInfo;
            //console.error(`Active channel order ${activeChannelInfo.getOrder()}`);        

            for (let i = 0; i < radiokayraPanel.channelBoxList.length; ++i) {
                let channelBox = radiokayraPanel.channelBoxList[i];
                if (channelBox._channelInfo.getOrder() > activeChannelInfo.getOrder()) return channelBox;
                
            }
            return radiokayraPanel.channelBoxList[0];
        }
        updateToolTip() {
            if (this._tooltip === null)
                return;            
            let text = "";            
            let artist = radiokayraPanel._streamInfoPopup._artist;
            let title = radiokayraPanel._streamInfoPopup._title;
            let channelName = radiokayraPanel._streamInfoPopup._channelName;
            let isPlaying = radiokayraPanel._player.isPlaying();            

            if (isPlaying) {                
                if (!Utils.isEmptyString(artist)) {                    
                    artist = Utils.processSpecialCharacters(artist, false);
                    text += Utils.truncateString(artist, Constants.MAX_TOOLTIP_WIDTH);
                    text += "\n";
                }                                   
    
                if (!Utils.isEmptyString(title)) {                    
                    title = Utils.processSpecialCharacters(title, false);
                    text += Utils.truncateString(title, Constants.MAX_TOOLTIP_WIDTH);
                    text += "\n";
                } 
            }
              
            if (!Utils.isEmptyString(channelName)) {                
                channelName = Utils.processSpecialCharacters(channelName, false);
                text += Utils.truncateString(channelName, Constants.MAX_TOOLTIP_WIDTH);            
            }                
            this._tooltip.text = text;
        }
        showTooltip() {            
            if (this._tooltip === null || !radiokayraPanel._settings.get_boolean(Constants.SCHEMA_SONG_TOOLTIP))
                return;
            this.updateToolTip();
            this._tooltip.opacity = 0;
            this._tooltip.show();

            let [stageX, stageY] = this.get_transformed_position();
            
            let itemWidth = this.allocation.x2 - this.allocation.x1;
            let tooltipWidth = this._tooltip.get_width();
            
            let y = stageY + 40;
            let x = Math.floor(stageX + itemWidth / 2 - tooltipWidth / 2);

            let parent = this._tooltip.get_parent();
            let parentWidth = parent.allocation.x2 - parent.allocation.x1;

            if (Clutter.get_default_text_direction() === Clutter.TextDirection.LTR) {
                // stop long tooltips falling off the right of the screen
                x = Math.min(x, parentWidth - tooltipWidth - 6);
                // but whatever happens don't let them fall of the left
                x = Math.max(x, 6);
            }
            else {
                x = Math.max(x, 6);
                x = Math.min(x, parentWidth - tooltipWidth - 6);
            }

            this._tooltip.set_position(x, y);
            this._tooltip.remove_all_transitions();
            this._tooltip.ease({
                opacity: 255,
                duration: 500,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD
            });
        }
        hideTooltip() {
            if (this._tooltip === null)
                return;
            this._tooltip.opacity = 255;

            this._tooltip.remove_all_transitions();
            this._tooltip.ease({
                opacity: 0,
                duration: 500,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => this._tooltip.hide()
            });
        }
        getShellversion() {
            const [major] = Config.PACKAGE_VERSION.split('.');
            return Number.parseInt(major);
        }        
        async _buildMenu() { }
    },
);