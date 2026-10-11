export const VOLUME_LEVEL_MUTED = 0;
export const VOLUME_LEVEL_LOW = 0.3;
export const VOLUME_LEVEL_MEDIUM = 0.6;
export const SEARCH_PIXEL_SIZE = 150;

export const MAX_TOOLTIP_WIDTH = 60;
export const MAX_SONG_TITLE = 80;

export const PLAY_ICON_SIZE = 60;
export const PLAY_PREV_ICON_SIZE = 40;
export const PLAY_NEXT_ICON_SIZE = 40;
export const CHANNEL_LIST_THUMB_SIZE = 28;
export const NOW_PLAYING_THUMB_SIZE = 128;
export const SEEK_BACK_SECONDS = 15;
export const SEEK_FORWARD_SECONDS = 30;
export const SEEK_ICON_SIZE = 20;
export const EPISODE_NAV_ICON_SIZE = 16;
export const POSITION_POLL_INTERVAL_SECONDS = 1;
export const POSITION_SAVE_INTERVAL_SECONDS = 30;
export const RESUME_EDGE_MARGIN_SECONDS = 10; //don't resume into the very start/end of an episode

export const MAX_RADIO_SEARCH_RESULTS = 30;

export const SETTINGS_FILE_NAME = "channels.json";
export const CONFIG_FOLDER_NAME = "radio-kayra";
export const RADIO_SEARCH_SERVER_URL = 'all.api.radio-browser.info';
export const RADIO_BROWSER_USER_AGENT = "RadioKayraReloaded/1.0 (+https://github.com/ayhanavci/radiokayra)";
export const RADIO_BROWSER_ORDER_OPTIONS = ["votes", "clickcount", "name", "random"];
export const RADIO_BROWSER_DEFAULT_ORDER = "votes";
export const CHANNEL_SOURCE_RADIOBROWSER = "radiobrowser";
export const CHANNEL_SOURCE_MANUAL = "manual";
export const CHANNEL_SOURCE_PODCASTINDEX = "podcastindex";
export const VOLUME_POWER = 2;

export const PODCASTINDEX_API_BASE = "https://api.podcastindex.org/api/1.0";

export const MUSICBRAINZ_USER_AGENT = "RadioKayraReloaded/1.0 (+https://github.com/ayhanavci/radiokayra)";
export const MUSICBRAINZ_MIN_INTERVAL_MS = 1100; //MusicBrainz asks for ~1 req/sec per client
export const MUSICBRAINZ_MIN_SCORE = 85; //minimum match confidence before trusting a search result
export const COVERART_MAX_CANDIDATES = 8; //cap how many releases we probe before giving up on a track
export const COVERART_CACHE_MAX_ENTRIES = 200;
export const PODCASTINDEX_USER_AGENT = "RadioKayraReloaded/1.0";
export const PODCASTINDEX_SIGNUP_URL = "https://api.podcastindex.org/signup";
export const PODCASTINDEX_SECRET_SCHEMA_ID = "org.gnome.shell.extensions.radiokayra-reloaded";
export const PODCASTINDEX_SECRET_ATTR_KEY = "podcastindex-key";
export const PODCASTINDEX_SECRET_ATTR_SECRET = "podcastindex-secret";
export const MAX_PODCAST_SEARCH_RESULTS = 20;
export const MAX_PODCAST_EPISODE_RESULTS = 30;

export const SCHEMA_CHANNELS_CHANGE_EVENT = "channelschangedevent";
export const SCHEMA_LAST_PLAYED = "lastplayed";
export const SCHEMA_VOLUME_LEVEL = "volumelevel";
export const SCHEMA_PANEL_HEIGHT = "panelheight";
export const SCHEMA_SONG_TOOLTIP = "showsongtooltip";
export const SCHEMA_SONG_NOTIFICATION = "shownewtracknotification";
export const SCHEMA_RIGHTCLICK_SETTINGS = "rightclicksettings";
export const SCHEMA_RIGHTCLICK_COPYSONG = "rightclickcopysong";
export const SCHEMA_GNOME_SEARCH = "gnomesearch";
export const SCHEMA_PREFS_WINDOW_WIDTH = "prefswindowwidth";
export const SCHEMA_PREFS_WINDOW_HEIGHT = "prefswindowheight";
export const SCHEMA_SYNC_FOLDER = "syncfolder";
export const SCHEMA_SYNC_LAST_AT = "synclastat";
export const SCHEMA_SYNC_LAST_REMOTE_MTIME = "synclastremotemtime";
export const SCHEMA_SYNC_LAST_LOCAL_MTIME = "synclastlocalmtime";
export const SCHEMA_ENRICH_TRACK_DATA = "enrichtrackdata";
export const SCHEMA_CHROMECAST_ENABLED = "chromecastenabled";

export const SYNC_BUNDLE_FILENAME = "radio-kayra-sync.json";
export const SYNC_BUNDLE_SCHEMA_VERSION = 1;
//Settings that sync (device-agnostic preferences). Deliberately excludes
//volumelevel, lastplayed, prefswindow*, and PodcastIndex credentials
//(those stay in the system keyring, never in a synced file).
export const SYNCED_SETTINGS_KEYS = [
    "panelheight", "showsongtooltip", "rightclicksettings", "rightclickcopysong", "gnomesearch",
];

export const CSS_SETTINGS_POPUP = "settings-menu-item";
export const CSS_CHANNEL_LIST_THUMBNAIL = "channel-list-item";
export const CSS_CHANNEL_LIST_LABEL = "channel-list-label";
export const CSS_SONG_INFO_CHANNEL_NAME = "song-info-channel-name";
export const CSS_SONG_INFO_ARTIST = "song-info-artist";
export const CSS_SONG_INFO_TITLE = "song-info-title";
export const CSS_SONG_INFO_DURATION = "song-info-duration";
export const CSS_LIVE_ICON = "song-info-live-icon";
export const CSS_SEEK_TIME_LABEL = "seek-time-label";
export const CSS_NEW_EPISODE_BADGE = "channel-list-new-badge";

export const ICON_RADIO_ON_PATH = "/images/radio-icon-on.svg";
export const ICON_RADIO_OFF_PATH = "/images/radio-icon-off.svg";
export const ICON_RADIO_ON_AIR_PATH = "/images/radio-live-symbolic.svg";
export const ICON_CAST_PATH = "/images/cast-symbolic.svg";
export const ICON_CHANNEL_THUMB_PLACEHOLDER = "audio-x-generic-symbolic";
export const ICON_VOLUME_MUTED = "audio-volume-muted-symbolic";
export const ICON_VOLUME_LOW = "audio-volume-low-symbolic";
export const ICON_VOLUME_MEDIUM = "audio-volume-medium-symbolic";
export const ICON_VOLUME_HIGH = "audio-volume-high-symbolic";
export const ICON_BACKWARD = "media-skip-backward-symbolic";
export const ICON_PLAY = "media-playback-start-symbolic";
export const ICON_FORWARD = "media-skip-forward-symbolic";
export const ICON_STOP = "media-playback-stop-symbolic";
export const ICON_SEEK_BACKWARD = "media-seek-backward-symbolic";
export const ICON_SEEK_FORWARD = "media-seek-forward-symbolic";
export const ICON_EPISODE_PREV = "go-previous-symbolic";
export const ICON_EPISODE_NEXT = "go-next-symbolic";
export const ICON_ADD_CHANNEL = "list-add-symbolic";
export const ICON_MOVE_DOWN = "go-down-symbolic";
export const ICON_MOVE_UP = "go-up-symbolic";
export const ICON_RADIO_SEARCH_PAGE = "radio-symbolic";
export const ICON_PODCAST_SEARCH_PAGE = "podcast-symbolic";
export const ICON_BUTTON_SEARCH_ADD = "list-add-symbolic";
export const ICON_SETTINGS = "emblem-system-symbolic";
export const ICON_STATIONS_PAGE = "playlist-symbolic";
export const ICON_DELETE_CHANNEL = "user-trash-symbolic";
export const ICON_EDIT_CHANNEL = "document-edit-symbolic";
export const ICON_SORT_CHANNELS = "view-sort-descending-symbolic";
export const ICON_PREVIEW_PLAY = "media-playback-start-symbolic";
export const ICON_PREVIEW_STOP = "media-playback-stop-symbolic";
export const PREVIEW_MAX_SECONDS = 20;
export const ICON_ABOUT = "help-about-symbolic";

export const LOG_PREFIX_UTILS = "Utils";

export const LOG_PREFIX_CHANNELS = "Channels";
export const LOG_FAILED_TO_LOAD_JSON = "Failed to load channels.json.";
export const LOG_FAILED_TO_PARSE_JSON = "Failed to parse channels.json.";
export const LOG_FAILED_TO_UPDATE_JSON = "Failed to update channels.json.";
export const LOG_FAILED_TO_CREATE_JSON = "Failed to create json file.";
export const LOG_FAILED_TO_CREATE_CONFIG_FOLDER = "Failed to create config folder.";

export const LOG_PREFIX_EXTENSION = "Extension";
export const LOG_INFO_CHANNELS_JSON_CHANGED = "Channels json changed.";
export const LOG_INFO_CHANNEL_CHANGED = "Channels json changed.";
export const LOG_INFO_NEXT_CHANNEL = "Next Channel";
export const LOG_INFO_PREVIOUS_CHANNEL = "Previous Channel";
export const LOG_INFO_CHANNEL_NAVIGATE = "Channel Navigate";
export const LOG_PLAYER_ERROR = "Player error.";

export const LOG_PREFIX_POPUPS = "Popups";
export const LOG_SHOW_THUMBNAIL_ERROR = "Show Thumbnail error.";
export const LOG_ADD_THUMBNAIL_ERROR = "Add Thumbnail error.";
export const LOG_INFO_SONG_LABEL_SHOW = "Song label show.";

export const LOG_PREFIX_PREPS = "Prefs";
export const LOG_FAILED_TO_FIND_CHANNEL = "Failed to find channel."

export const LOG_PREFIX_RADIO_PLAYER = "Radio";
export const LOG_GST_MESSAGE_RECEIVED = "Gst message.";
export const LOG_GST_STATE_CHANGED = "Gst state changed.";
export const LOG_GST_NEW_TAG = "Gst new tag received.";
export const LOG_GST_STREAM_STARTED = "Stream started.";
export const LOG_GST_STREAM_ENDED = "Stream ended.";
export const LOG_GST_PLUGIN_ERROR = "Gstreamer plugin missing.";

export const LOG_PREFIX_RADIO_SEARCH = "Radio search";
export const LOG_ERROR_ADD_SEARCH_ROW = "Add search row error.";
export const LOG_ERROR_LOAD_THUMBNAIL = "Load thumbnail error.";
export const LOG_ERROR_SAVE_THUMBNAIL = "Save thumbnail error.";
export const LOG_ERROR_JSON_EMPTY = "Json empty!";

