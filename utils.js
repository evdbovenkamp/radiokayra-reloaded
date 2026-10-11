import Gio from "gi://Gio";
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import * as Constants from "./constants.js";

export function processSpecialCharacters(str, isEncode) {
  if (isEncode) {
    return str
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;");
  }
  //Decode: also accept the old, malformed entities (missing ';') that earlier
  //versions wrote into channels.json, so existing favorites still decode cleanly.
  return str
    .replaceAll("&lt;", "<")
    .replaceAll("&lt", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&gt", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

export function isEmptyString(str) {
  return str === "" || str === null || str === undefined;
}

export function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0,
      v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function saveThumbnail(thumbnailPath, destinationFileName) {  
  try {
      const file = Gio.File.new_for_uri(thumbnailPath);
      const destinationFile = Gio.File.new_for_path(destinationFileName);
      file.copy(destinationFile, Gio.FileCopyFlags.OVERWRITE, null, () => { 
          // Report copy-status:
          /*print ("%" + int64.FORMAT + " bytes of %" + int64.FORMAT + " bytes copied.\n",
              current_num_bytes, total_num_bytes);*/
      });
  }
  catch (error) {
      console.warn(`${Constants.LOG_PREFIX_UTILS} ${Constants.LOG_ERROR_SAVE_THUMBNAIL} 2:  [${error}] [${thumbnailPath}]->[${destinationFileName}]`);
  }
}

export function getConfigPath() { return GLib.get_user_config_dir() + "/" + Constants.CONFIG_FOLDER_NAME; }

export function truncateString(string, limit) {
    if (string.length <= limit) return string;
    return string.slice(0, limit) + "...";
}

//Picks a random live radio-browser.info mirror via DNS, as recommended by their API docs
//(spreads load across mirrors instead of hammering a single one).
export function resolveRadioBrowserServer(onResolved) {
  try {
    const resolver = Gio.Resolver.get_default();
    resolver.lookup_by_name_async(Constants.RADIO_SEARCH_SERVER_URL, null, (source, result) => {
      try {
        const addresses = source.lookup_by_name_finish(result);
        const address = addresses[Math.floor(Math.random() * addresses.length)];
        onResolved(source.lookup_by_address(address, null));
      } catch (error) {
        console.warn(`${Constants.LOG_PREFIX_UTILS} Failed to resolve radio-browser.info server: [${error}]`);
        onResolved(null);
      }
    });
  } catch (error) {
    console.warn(`${Constants.LOG_PREFIX_UTILS} Failed to resolve radio-browser.info server: [${error}]`);
    onResolved(null);
  }
}

//Tells radio-browser.info a station was actually played, as their API etiquette asks of
//clients. Best-effort / fire-and-forget: failures are silently ignored.
export function registerRadioBrowserClick(stationUuid) {
  if (isEmptyString(stationUuid)) return;
  resolveRadioBrowserServer((server) => {
    if (isEmptyString(server)) return;
    try {
      const httpSession = new Soup.Session({ user_agent: Constants.RADIO_BROWSER_USER_AGENT, timeout: 10 });
      const message = Soup.Message.new("GET", `https://${server}/json/url/${stationUuid}`);
      httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, () => { /* fire and forget */ });
    } catch (error) {
      console.warn(`${Constants.LOG_PREFIX_UTILS} Failed to register radio-browser.info click: [${error}]`);
    }
  });
}

