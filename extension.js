import { Extension, gettext as _, } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import GIRepository from "gi://GIRepository";
import * as KayraMenu from "./kayramenu.js";

export default class RadioKayraExtension extends Extension {
  constructor(metadata) {
    super(metadata);
    //console.info(`constructing ${this.metadata.name}`);
  }

  //A typelib probe, not an import: this never pulls Gst/GstPbutils into the
  //module graph, so it's safe to run even when GStreamer isn't installed at
  //all (an actual `import Gst from "gi://Gst"` failing would otherwise take
  //down this whole file's module graph, silently killing the extension).
  isGstreamerAvailable() {
    try {
      const repo = GIRepository.Repository.dup_default();
      repo.require("Gst", "1.0", 0);
      repo.require("GstPbutils", "1.0", 0);
      return true;
    } catch (e) {
      console.error(`${this.metadata.name}: GStreamer not available: [${e}]`);
      return false;
    }
  }

  enable() {
    let gstAvailable = this.isGstreamerAvailable();
    if (!gstAvailable) {
      Main.notify(this.metadata.name, _("GStreamer is missing or not installed. Install GStreamer to play radio stations and podcasts."));
    }
    this.menuButton = new KayraMenu.RadiokayraMenuButton(this, gstAvailable);
    this._provider = null;
    Main.panel.addToStatusArea(this.uuid, this.menuButton);
  }

  disable() {
    this.menuButton?.destroy();
    this.menuButton = null;
  }
}
