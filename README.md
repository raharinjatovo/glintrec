# GlintRec

Screen recorder for Windows, macOS and Linux with webcam, annotations, zoom and mouse effects. Electron + TypeScript application.

## Download

Grab the latest build for your OS from the [Releases](../../releases) page:

| OS | File |
|---|---|
| Windows (x64) | `GlintRec-<version>-win-x64.exe` (NSIS installer) |
| macOS (Intel / Apple Silicon) | `GlintRec-<version>-mac-<arch>.dmg` or `.zip` |
| Linux (x64) | `GlintRec-<version>-linux-x64.AppImage` |

## Features

- **Capture modes**: screen + camera (bubble) or camera only, switchable live while recording. The camera shrinks to the bubble (and back) with an animated transition.
- **Floating control bar**: Pause/Resume, Cam only ↔ Cam + screen, Stop. Always on top and **not visible in the video**. In mobile output it docks to the mobile window and the annotation bar.
- **Freehand annotations** drawn over the screen and recorded in the video. Controls stay available in the annotation bar.
- **Zoom**: manual and auto-zoom on clicks, with a zoom indicator that is not recorded.
- **Effects**: cursor highlight, click ripples, key display.
- **PC (16:9) or mobile (9:16) output**; in mobile, framing is "full screen", "focus point" or "follow cursor".
- **Camera background**: blur, color or image (MediaPipe segmentation).
- **Audio**: microphone, system audio, or video only.
- Screenshots, recordings library, trimming.

## Default shortcuts

| Action | Shortcut |
|---|---|
| Start / stop | `Ctrl+Shift+R` |
| Pause / resume | `Ctrl+Shift+P` |
| Screenshot | `Ctrl+Shift+S` |
| Annotate | `Ctrl+Shift+D` |
| Zoom + / − / reset | `Ctrl+Alt+PageUp` / `PageDown` / `Home` |
| Camera mode | `Ctrl+Alt+F9` |

All of them can be changed in the settings.

## Development

Requirements: Node.js 22+.

```bash
npm install
npm run assets    # fetch the MediaPipe model and wasm (assets/mediapipe)
npm start         # build + launch the app
```

| Command | Purpose |
|---|---|
| `npm run typecheck` | TypeScript check |
| `npm test` | tests (vitest) |
| `npm run check` | typecheck + build + tests |
| `npm run pack` | unpacked build for the current OS (`release/`) |
| `npm run dist:win` | Windows NSIS installer |
| `npm run dist:mac` | macOS dmg + zip (x64 and arm64), must run on macOS |
| `npm run dist:linux` | Linux AppImage, best run on Linux |

## Releasing

Pushing a version tag builds the Windows, macOS and Linux packages on GitHub Actions and attaches them to a GitHub Release:

```bash
git tag v2.0.0
git push origin v2.0.0
```

The workflow lives in `.github/workflows/release.yml` and can also be started manually (artifacts only, no release).

## Structure

```
src/main/      Electron main process (windows, IPC, shortcuts, files)
src/preload/   contextBridge bridges
src/renderer/  UI, canvas compositor, effects
src/shared/    shared pure logic (tested)
tests/         vitest tests
scripts/       build and asset fetching
```

## Notes

- Builds are not signed. Windows SmartScreen may warn; on macOS, right-click the app and choose Open (or run `xattr -cr /Applications/GlintRec.app`).
- macOS requires Screen Recording, Camera, Microphone and Accessibility (global key/mouse hooks) permissions in System Settings.
- Linux: global input hooks need X11; on Wayland some features (key display, auto-zoom on clicks, hiding overlays from the capture) may be limited. System audio capture is not available on every platform.
- Key display also records passwords typed during recording: disabled by default.
- If the floating bar misbehaves, a log is written to `control-hud.log` in the app's user data folder (`%APPDATA%\glintrec` on Windows).
