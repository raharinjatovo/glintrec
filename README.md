# GlintRec

Enregistreur d'écran pour Windows avec webcam, annotations, zoom et effets de souris. Application Electron + TypeScript.

## Fonctionnalités

- **Modes de capture** : écran + caméra (bulle) ou caméra seule, avec bascule en direct pendant l'enregistrement. La caméra se réduit vers la bulle (et inversement) avec une transition animée.
- **Barre de contrôle flottante** : Pause/Reprendre, Cam seule ↔ Cam + écran, Stop. Toujours au premier plan et **absente de la vidéo**. En sortie mobile, elle se colle à la fenêtre mobile et à la barre d'annotation.
- **Annotations** à main levée par-dessus l'écran, enregistrées dans la vidéo. Les contrôles restent disponibles dans la barre d'annotation.
- **Zoom** manuel et auto-zoom sur les clics, avec un indicateur de zoom hors vidéo.
- **Effets** : surbrillance du curseur, ondulations au clic, affichage des touches.
- **Sortie PC (16:9) ou mobile (9:16)** ; en mobile, cadrage « tout l'écran », « point de focus » ou « suit le curseur ».
- **Arrière-plan caméra** : flou, couleur ou image (segmentation MediaPipe).
- **Audio** : micro, audio système, option vidéo seule.
- Capture d'écran, bibliothèque d'enregistrements, rognage (trim).

## Raccourcis par défaut

| Action | Raccourci |
|---|---|
| Démarrer / arrêter | `Ctrl+Shift+R` |
| Pause / reprise | `Ctrl+Shift+P` |
| Capture d'écran | `Ctrl+Shift+S` |
| Annoter | `Ctrl+Shift+D` |
| Zoom + / − / reset | `Ctrl+Alt+PageUp` / `PageDown` / `Home` |
| Mode caméra | `Ctrl+Alt+F9` |

Tous sont modifiables dans les paramètres.

## Développement

Prérequis : Node.js, Windows x64.

```bash
npm install
npm run assets    # récupère le modèle et le wasm MediaPipe (assets/mediapipe)
npm start         # build + lance l'application
```

| Commande | Rôle |
|---|---|
| `npm run typecheck` | vérification TypeScript |
| `npm test` | tests (vitest) |
| `npm run check` | typecheck + build + tests |
| `npm run pack` | build non empaqueté (`release/win-unpacked`) |
| `npm run dist` | installateur NSIS (`release/GlintRec Setup <version>.exe`) |

## Structure

```
src/main/      processus principal Electron (fenêtres, IPC, raccourcis, fichiers)
src/preload/   passerelles contextBridge
src/renderer/  interface, compositeur canvas, effets
src/shared/    logique pure partagée (testée)
tests/         tests vitest
scripts/       build et récupération des assets
```

## Notes

- L'installateur n'est pas signé : Windows SmartScreen peut afficher un avertissement.
- L'affichage des touches enregistre aussi les mots de passe saisis pendant l'enregistrement : désactivé par défaut.
- En cas de souci avec la barre flottante, un journal est écrit dans `%APPDATA%\glintrec\control-hud.log`.
