# dsh-ui-background

Local image/video wallpaper plus a full-window frosted-glass treatment for the **DeepSeek Harness Web client**.

> Status: `0.8.0`, developed and verified against **DSH 0.2.0-rc.2**. Harness internals move during the RC period — re-verify after upgrading.

## What it is (and why it does not stutter)

The glass is **not** produced by scanning the DOM. It overrides the official theme tokens:

```js
ctx.theme.overrideTokens('dsh-ui-background', {
  '--dsw-alias-bg-base':         { light: 'rgba(255,255,255,.62)', dark: '…' },
  '--dsw-specific-sidebar-fill': { light: '…', dark: '…' },
  // plus three raised-surface / overlay tokens
})
```

DSH paints `body`, the app frame and the sidebar with those tokens, so:

- no DOM scanning, no `MutationObserver`, no per-panel `backdrop-filter`
- turning it off disposes the token layer — the UI returns to the shipped palette
- the wallpaper is **one** `position:fixed; z-index:-1` layer (pure CSS for images, a single `<video>` for video)

## Features

- Sources: uploaded file, or an absolute local path (read-only; never copied or moved)
- Video wallpapers (`mp4` / `webm`): looped, muted, paused when the tab is hidden
- Framing: `cover` / `contain`, zoom 50–300 %, horizontal/vertical anchor, draggable preview
- Wallpaper Engine: scans the Steam workshop folder `431960` and lists only directly playable entries
- Recents: up to 12 entries with thumbnails **and their framing**, one click to restore, per-entry delete
- Uploaded files can be deleted individually; deleting the active one turns the background off
- Fully local: no network access, no telemetry

## Install

```bash
dsh plugin --profile web add dsh-ui-background
```

**Restart the Host afterwards.** DSH builds its module resolution table at startup, so a freshly installed package cannot be imported in the running process.

Then open Settings → **Background & Glass**.

## How it differs from Wallpaper Engine plugins

| | This plugin | Wallpaper Engine based plugins |
|---|---|---|
| Sources | any local image or video; it can also list directly playable Steam Workshop items | primarily WE scene projects |
| Prerequisites | none — Wallpaper Engine is not required | Wallpaper Engine and its assets |
| Re-framing after a switch | not needed: each history entry stores its framing (cover/contain, zoom, horizontal/vertical position) | depends on the implementation |
| Effect on the page | overrides the official `--dsw-*` theme tokens only; no DOM scanning, no per-frame work | some rewrite the DOM structure |

To be explicit about the boundary: `dsh-wallpaper-engine` can actually **render** Wallpaper Engine scenes, which this plugin cannot — `scene.pkg` requires WE's own engine. This plugin does not compete on rendering; it does one thing: stay lightweight, non-invasive, and token-based.
## Limitations

| Limitation | Why |
|---|---|
| Scene wallpapers cannot be used | `scene.pkg` is a Wallpaper Engine format that only its engine can render |
| Do not use WE preview images | Measured at **144–254 px**; stretching to 1920 is a 7–13× upscale |
| Want a WE scene? take a screenshot | Run WE, press `Win+Shift+S`, then use the paste button (1920×1080) |
| `mkv` / `mov` may not play | Edge does not decode those containers; use `mp4` / `webm` |

## Security

- The Host reads only the single local file you configure, plus `project.json` / media / previews inside the Steam workshop folder
- HTTP routes are loopback only; writes reject `sec-fetch-site: cross-site`
- Uploaded file names are sanitised; path traversal is rejected
- State lives in `$DSH_HOME/storages/dsh-ui-background/` and is **not** removed when the plugin is uninstalled

## License

MIT
