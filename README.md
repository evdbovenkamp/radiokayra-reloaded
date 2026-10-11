# Radio Kayra Reloaded

A GNOME Shell extension to search, play and manage internet radio stations and podcasts from the top panel.

This is an independent fork of [**Radio Kayra**](https://github.com/ayhanavci/radiokayra) by **Ayhan Avcı**. The original project is the reason this exists at all — a clean, simple, well-organized radio extension for GNOME. This fork started because the original had gone quiet for a while and there were specific directions (podcasts, sync, casting) worth pushing further. If you're looking for the original, lighter-weight extension, go there first and give it a star.

This fork's design, code and features were built entirely in collaboration with [Claude](https://claude.com/claude-code) (Anthropic's AI coding assistant) — from architecture decisions down to live debugging against real hardware (actual Chromecast devices, real radio-browser.info/PodcastIndex.org APIs).

## What's different from the original Radio Kayra

| | Original Radio Kayra | Radio Kayra Reloaded |
|---|---|---|
| Radio station search | ✅ radio-browser.info | ✅ radio-browser.info (with country/tag filters, preview before adding) |
| YouTube / yt-dlp support | ✅ | ❌ removed entirely (see below) |
| Podcasts | ❌ | ✅ PodcastIndex.org — search, subscribe, episode browsing, new-episode badges |
| Podcast playback controls | ❌ | ✅ seek slider, ±15s/30s skip, next/previous episode, resume position |
| Cross-device sync | ❌ | ✅ stations, settings and podcast playback position, via a folder you choose |
| Track cover art | ❌ | ✅ via MusicBrainz + Cover Art Archive (toggle, on by default) |
| Cast to Chromecast / Google TV | ❌ | ✅ |
| Station preview before adding | ❌ | ✅ (20s, radio only) |
| New-track desktop notification | ❌ | ✅ (toggle) |
| Channel list | flat, manual reorder only | grouped (Podcasts / Radio), bulk sort by name or type, plus manual reorder |
| Credential storage | n/a | PodcastIndex API key stored in the system keyring, never in a plain file |

**Why yt-dlp/YouTube was dropped:** it pulled in a large external dependency and a lot of complexity (and fragility — yt-dlp breaks on upstream site changes often) for something outside this fork's actual focus: internet radio and podcasts. If you need YouTube playback in a GNOME Shell extension, the original Radio Kayra still does that well.

## Features

- **Radio.** Search 50,000+ stations via [radio-browser.info](https://www.radio-browser.info/), filter by country/tag, preview a station for up to 20 seconds before adding it, add manual stream URLs directly.
- **Podcasts.** Search and subscribe via [PodcastIndex.org](https://podcastindex.org/) (free API key required, see below). Subscribe to a whole feed (always plays the latest episode) or add a single episode. Seek slider, skip ±15s/30s, next/previous episode, and your playback position syncs across machines.
- **Cover art.** Looks up the currently-playing radio track via MusicBrainz and Cover Art Archive and shows the cover in the now-playing panel and in track notifications. On by default, one toggle to turn off.
- **Cast.** Send the current station or episode straight to a Chromecast or Google TV device — the device streams the URL itself, nothing is relayed through your machine. Requires `python3-pychromecast` (see Requirements).
- **Sync.** Point the extension at a folder — local, or an already-mounted Nextcloud/Dropbox/WebDAV location — and your station list, settings, and podcast playback position stay in sync across computers. Pushes on close, pulls on open; newest change wins.
- **Everything else you'd expect:** a clear Podcasts/Radio split in the station list, bulk and manual sorting, a desktop notification on track change, GNOME Shell search integration, a hover tooltip with the current track, and a startup check that tells you clearly if GStreamer is missing instead of silently failing.

## Requirements

- GNOME Shell 46, 47, 48, 49 or 50.
- [GStreamer](https://gstreamer.freedesktop.org/download/#linux) — required for all playback. The extension checks for this at startup and tells you clearly if it's missing.
- `python3-pychromecast` — **optional**, only needed for the "Cast to…" feature. Everything else works without it; the Settings page tells you if it's missing and how to install it.
- A free [PodcastIndex.org API key](https://api.podcastindex.org/signup) — **optional**, only needed for podcast search. Radio works without it.

## Installation

### Quick install

```bash
git clone https://github.com/evdbovenkamp/radiokayra-reloaded.git
cd radiokayra-reloaded
./install.sh
```

`install.sh` does not copy the extension: it creates a symlink from `~/.local/share/gnome-shell/extensions/radiokayra-reloaded@europetrader.gmail.com` to the folder you cloned into. **Keep that folder where it is** — moving or deleting it breaks the extension. If something already exists at the extension path, the script asks before replacing it, so run it from an interactive terminal.

Then log out and log back in — GNOME Shell only loads newly-installed extensions on login — and enable it:

```bash
gnome-extensions enable radiokayra-reloaded@europetrader.gmail.com
```

(Or use the GNOME Extensions app / GNOME Tweaks.)

Run the `enable` command *after* logging back in. Before that (especially on Wayland, where GNOME Shell can't be restarted in place) `gnome-extensions` reports `Extension "radiokayra-reloaded@europetrader.gmail.com" doesn't exist` — that's expected, not a failed install.

### Manual install

```bash
git clone https://github.com/evdbovenkamp/radiokayra-reloaded.git \
    ~/.local/share/gnome-shell/extensions/radiokayra-reloaded@europetrader.gmail.com
glib-compile-schemas ~/.local/share/gnome-shell/extensions/radiokayra-reloaded@europetrader.gmail.com/schemas/
```

Here the clone itself *is* the extension folder, no symlink involved. Then log out/in and enable it as above.

### GStreamer plugins

Most distros split GStreamer into several packages, and many desktop installs already have them. `install.sh` checks for GStreamer and tells you if it's missing. On Ubuntu/Debian:

```bash
sudo apt install gstreamer1.0-tools gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly gstreamer1.0-libav
```

On other distros, install the equivalent "good", "bad" and "ugly" plugin sets plus the libav/FFmpeg plugin — e.g. on Arch: `gst-plugins-good gst-plugins-bad gst-plugins-ugly gst-libav`. This extension was built and tested on Ubuntu (GNOME Shell 50); other distros should work but are untested.

### Casting (optional)

```bash
sudo apt install python3-pychromecast
```

### Podcasts (optional)

1. Sign up at [api.podcastindex.org/signup](https://api.podcastindex.org/signup). You'll receive two values by e-mail: an **API Key** and an **API Secret** — you need both.
2. Open the extension's Settings: click the radio icon in the top panel and choose **Settings**, or run `gnome-extensions prefs radiokayra-reloaded@europetrader.gmail.com`, or use the Extensions app.
3. In the **PodcastIndex.org** section, fill in **API Key** and **API Secret** and click **Save**. The fields clear after saving and the **Status** row shows whether the credentials are configured.

The credentials are stored in your system keyring (libsecret), never in a plain file.

## Updating

Run this from the folder you cloned into. With the quick install that's your clone (e.g. `~/radiokayra-reloaded`); with the manual install it's the extension folder itself. The extension path below works for both, since with the quick install it's a symlink to your clone:

```bash
cd ~/.local/share/gnome-shell/extensions/radiokayra-reloaded@europetrader.gmail.com
git pull
glib-compile-schemas schemas/
```

Log out and back in afterward — GNOME Shell doesn't reload an extension's panel code without a fresh session.

## Configuration file locations

- Stations and settings sync bundle, when sync is enabled: in the folder you choose.
- Station thumbnails and `channels.json`: `~/.config/radio-kayra`.
- Podcast playback positions: `positions.json` alongside `channels.json` (and in your sync folder, if enabled).
- PodcastIndex API credentials: your system keyring (libsecret), not a file.

## Contributing

Issues and pull requests are welcome. Please keep platform-specific assumptions (this was built and tested on Ubuntu) called out explicitly if you hit something distro-specific.

## Credits

- [Ayhan Avcı](https://github.com/ayhanavci) for the original [Radio Kayra](https://github.com/ayhanavci/radiokayra) — this fork would not exist without it.
- [radio-browser.info](https://www.radio-browser.info/) for the radio station directory.
- [PodcastIndex.org](https://podcastindex.org/) for the podcast directory.
- [MusicBrainz](https://musicbrainz.org/) and the [Cover Art Archive](https://coverartarchive.org/) for track metadata and cover art.
- [python3-pychromecast](https://github.com/home-assistant-libs/pychromecast) for Chromecast support.

## License

See [LICENSE](LICENSE).
