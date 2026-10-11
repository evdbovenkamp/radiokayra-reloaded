import Gio from "gi://Gio";
import GLib from "gi://GLib";
import * as Constants from "./constants.js";

export const ChannelInfo = class ChannelInfo {
  constructor(id, name, uri, order, meta = {}) {
    this.id = id;
    this.name = name;
    this.uri = uri;
    this.order = order;
    //Optional metadata, populated when added via radio-browser.info or
    //PodcastIndex.org search: source, stationuuid/feedId, favicon, tags,
    //country, codec, bitrate, homepage, feedTitle, duration, datePublished.
    Object.assign(this, meta);
  }
  getId() { return this.id; }
  getName() { return this.name; }
  getOrder() { return this.order; }
  getUri() { return this.uri; }
  getStationUuid() { return this.stationuuid; }
  getSource() { return this.source; }
  setName(name) { this.name = name; }
  setUri(uri) { this.uri = uri; }
};
export const ChannelsReadWrite = class ChannelsReadWrite {
  constructor(extensionPath) {
    this.extensionPath = extensionPath;
    this.configFolder = GLib.get_user_config_dir() + "/" + Constants.CONFIG_FOLDER_NAME;
    this.channelsFilePath = this.configFolder + "/" + Constants.SETTINGS_FILE_NAME;
  }
  
  getChannels() {
    this.ensureChannelsFile();
    return this.readChannelsFile();
  }

  readChannelsFile() {
    const file = Gio.File.new_for_path(this.channelsFilePath);
    let contents;
    try {
      [, contents] = file.load_contents(null);      
    } catch (e) {        
      console.warn(`${Constants.LOG_PREFIX_CHANNELS} ${Constants.LOG_FAILED_TO_LOAD_JSON}: [${e}]`);
      return null;
    }
    const decoder = new TextDecoder("utf-8");
    const channelsString = decoder.decode(contents);

    let channelsData = null;
    try { channelsData = JSON.parse(channelsString); }
    catch (e) { console.warn(`${Constants.LOG_PREFIX_CHANNELS} ${Constants.LOG_FAILED_TO_PARSE_JSON}:[${e}]`); }

    //Migration: older versions stored a useYtdlp flag; yt-dlp resolving no
    //longer exists, every channel uri is now played directly.
    if (Array.isArray(channelsData))
      channelsData.forEach(channel => delete channel.useYtdlp);

    return channelsData;
  }
  writeChannelsFile(channelsData) {
    try {
      const file = Gio.File.new_for_path(this.channelsFilePath);
      const jsonString = JSON.stringify(channelsData, null, "\t");
      const encoder = new TextEncoder("utf-8");
      const channelsString = encoder.encode(jsonString);
      file.replace_contents(channelsString, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    } 
    catch (e) { console.warn(`${Constants.LOG_PREFIX_CHANNELS} ${Constants.LOG_FAILED_TO_UPDATE_JSON}:[${e}]`); }
  }

  ensureChannelsFile() {
    let folder = Gio.file_new_for_path(this.configFolder);

    if (!folder.query_exists(null)) {
      try { folder.make_directory(null); } 
      catch (error) {         
        console.error(`${Constants.LOG_PREFIX_CHANNELS} ${Constants.LOG_FAILED_TO_CREATE_CONFIG_FOLDER}:[${error}]`);
        return;
      }
    }
    let channelsFile = folder.get_child(Constants.SETTINGS_FILE_NAME);
    //Check if the channels json file exists. If it doesn't, create and copy the contents of the default file.
    if (!channelsFile.query_exists(null)) {
      try {
        let defaultFile = Gio.file_new_for_path(this.extensionPath).get_child(Constants.SETTINGS_FILE_NAME,);
        defaultFile.copy(channelsFile, Gio.FileCopyFlags.NONE, null, null);
      } catch (e) { console.error(`${Constants.LOG_PREFIX_CHANNELS} ${Constants.LOG_FAILED_TO_CREATE_JSON}:[${e}]`); }      
    }
  }
};

