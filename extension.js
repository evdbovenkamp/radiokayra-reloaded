import { Extension, gettext as _, } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as KayraMenu from "./kayramenu.js";

export default class RadioKayraExtension extends Extension {
  constructor(metadata) {
    super(metadata);
    //console.info(`constructing ${this.metadata.name}`);
  }

  enable() {
    this.menuButton = new KayraMenu.RadiokayraMenuButton(this);
    this._provider = null;
    Main.panel.addToStatusArea(this.uuid, this.menuButton);
  }

  disable() {
    this.menuButton?.destroy();
    this.menuButton = null;
  }
}