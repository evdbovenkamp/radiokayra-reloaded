import Gst from "gi://Gst";
import Gstpbutils from "gi://GstPbutils";
import * as Constants from "./constants.js";

export const RadioPlayer = class RadioPlayer {
  constructor(volume) {
    this.volume = volume;
    this.source = null;
    this.initialized = false;
  }
  isSourceReady() { return this.source !== null; }
  initPipeLine() {
    Gst.init(null);
    this.pipeline = new Gst.Pipeline({ name: "Radio Kayra Stream" });
    this.playing = false;
    this.initialized = true;
    this.readTags();
  }
  changeChannel(uri) {
    if (!this.initialized) this.initPipeLine();
    if (this.source !== null) this.pipeline.remove(this.source);
    this.source = Gst.ElementFactory.make("playbin3", "source");
    this.source.set_property("uri", uri);
    this.source.set_property("volume", this.volume);
    this.pipeline.add(this.source);
    this._readyToSeekFired = false; //fire setOnReadyToSeek once for this source

    this.source.set_property("flags", 0x00000080 | 0x00000010 | 0x00000002); //https://gstreamer.freedesktop.org/documentation/playback/playsink.html?gi-language=javascript#GstPlayFlags
  }
  //Seconds, or null if not known yet (nothing playing, or not seekable).
  getPosition() {
    if (!this.initialized) return null;
    let [ok, position] = this.pipeline.query_position(Gst.Format.TIME);
    return ok ? position / Gst.SECOND : null;
  }
  getDuration() {
    if (!this.initialized) return null;
    let [ok, duration] = this.pipeline.query_duration(Gst.Format.TIME);
    return ok && duration > 0 ? duration / Gst.SECOND : null;
  }
  //A known, finite duration is the practical signal that this is an
  //on-demand file (a podcast episode) rather than a live radio stream.
  isSeekable() { return this.getDuration() !== null; }
  seekTo(seconds) {
    if (!this.isSeekable()) return;
    this.pipeline.seek_simple(Gst.Format.TIME, Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT, seconds * Gst.SECOND);
  }
  seekBy(deltaSeconds) {
    let position = this.getPosition();
    if (position === null) return;
    let target = Math.max(0, position + deltaSeconds);
    let duration = this.getDuration();
    if (duration !== null) target = Math.min(target, duration);
    this.seekTo(target);
  }
  play() {
    if (!this.initialized) this.initPipeLine();
    this.pipeline.set_state(Gst.State.PLAYING);
    this.playing = true;
  }
  stop() {
    if (!this.initialized) return;
    this.pipeline.set_state(Gst.State.NULL);
    this.playing = false;
  }
  setVolume(newValue) {
    this.volume = Math.pow(newValue, Constants.VOLUME_POWER);
    if (this.source) this.source.set_property("volume", this.volume);
  }
  readTags() {
    this.sourceBus = this.pipeline.get_bus();
    this.sourceBus.add_signal_watch();
    this.sourceBusId = this.sourceBus.connect('message', (sbus, message) => { if (message !== null) this.onGstMessage(message); });
  }
  disconnectSourceBus() {
    if (this.sourceBusId) {
      this.sourceBus.disconnect(this.sourceBusId);
      this.sourceBusId = 0;
    }
  }
  isPlaying() { return this.playing; }

  setOnError(onError) { this.onError = onError; }
  setOnStreamStarted(onStreamStarted) { this.onStreamStarted = onStreamStarted; }
  setOnStreamEnded(onStreamEnded) { this.onStreamEnded = onStreamEnded; }
  setOnTagChanged(onTagChanged) { this.onTagChanged = onTagChanged; }
  //Fires once per changeChannel(), the first time position/duration/seeking
  //can actually be queried — the right moment to apply a saved resume position.
  setOnReadyToSeek(onReadyToSeek) { this.onReadyToSeek = onReadyToSeek; }

  onGstMessage(message) {
    
    //console.log(`${Constants.LOG_PREFIX_RADIO_PLAYER} ${Constants.LOG_INFO_SOLOG_GST_MESSAGE_RECEIVEDNG_LABEL_SHOW}: [${message.type}]`);
    switch (message.type) {
      case Gst.MessageType.STATE_CHANGED:
        //console.log(`${Constants.LOG_PREFIX_RADIO_PLAYER} ${Constants.LOG_GST_STATE_CHANGED}: [${msg.parse_state_changed()}]`);
        break;
      case Gst.MessageType.ASYNC_DONE:
        if (!this._readyToSeekFired) {
          this._readyToSeekFired = true;
          if (this.onReadyToSeek) this.onReadyToSeek();
        }
        break;
      case Gst.MessageType.ELEMENT:
        if (Gstpbutils.is_missing_plugin_message(message)) {
          let pluginDescription = Gstpbutils.missing_plugin_message_get_description(message);
          this.stop();
          if (this.onError !== null)
            this.onError(1, "Gstreamer plugin missing for " + pluginDescription);
          console.warn(`${Constants.LOG_PREFIX_RADIO_PLAYER} ${Constants.LOG_GST_PLUGIN_ERROR}: [${pluginDescription}]`);
        }
        break;
      case Gst.MessageType.TAG:
        {
          let tagList = message.parse_tag();
          let artist = "";
          let title = "";

          if (tagList.get_string("artist") !== null) artist = tagList.get_string("artist")[1];
          if (tagList.get_string("title") !== null) title = tagList.get_string("title")[1];
          if (this.onTagChanged !== null) this.onTagChanged(artist, title);
          break;
        }
      case Gst.MessageType.STREAM_START:
        //console.log(`${Constants.LOG_PREFIX_RADIO_PLAYER} ${Constants.LOG_GST_STREAM_STARTED}`);                         
        if (this.onStreamStarted !== null) this.onStreamStarted();
        break;
      case Gst.MessageType.NEED_CONTEXT: //536870912
        break;
      case Gst.MessageType.HAVE_CONTEXT: //1073741824
        break;
      case Gst.MessageType.STREAM_STATUS: //8192
        break;
      case Gst.MessageType.NEW_CLOCK: //2048
        break;
      case Gst.MessageType.EOS:
        //console.log(`${Constants.LOG_PREFIX_RADIO_PLAYER} ${Constants.LOG_GST_STREAM_ENDED}`);  
        if (this.onStreamEnded !== null) this.onStreamEnded();
        break;
      case Gst.MessageType.ERROR:
        {
          let error, debug_msg = message.parse_error();
          console.warn(`${Constants.LOG_PREFIX_RADIO_PLAYER} ${Constants.LOG_ERROR_GST_MESSAGE}: [${error}] [${debug_msg}]`);
          this.stop();
          if (this.onError !== null) this.onError(2, error + " " + debug_msg);
          break;
        }
      default:
        break;
    }
  }
}