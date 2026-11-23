import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...s) => join(root, ...s);

if (!existsSync(p('assets', 'mediapipe', 'selfie_segmenter.tflite')) || !existsSync(p('assets', 'mediapipe', 'wasm'))) {
  console.error('MediaPipe assets missing: run `npm run assets`');
  process.exit(1);
}

rmSync(p('dist'), { recursive: true, force: true });

const common = { bundle: true, sourcemap: true, minify: false, logLevel: 'info' };
await Promise.all([
  build({ ...common, entryPoints: [p('src/main/main.ts')], outfile: p('dist/main/main.js'), platform: 'node', format: 'cjs', target: 'node22', external: ['electron', 'uiohook-napi'] }),
  build({ ...common, entryPoints: [p('src/preload/preload.ts')], outfile: p('dist/preload/preload.js'), platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] }),
  build({ ...common, entryPoints: [p('src/preload/annotate-preload.ts')], outfile: p('dist/preload/annotate-preload.js'), platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] }),
  build({ ...common, entryPoints: [p('src/preload/control-hud-preload.ts')], outfile: p('dist/preload/control-hud-preload.js'), platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] }),
  build({ ...common, entryPoints: [p('src/preload/mobile-browser-preload.ts')], outfile: p('dist/preload/mobile-browser-preload.js'), platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] }),
  build({ ...common, entryPoints: [p('src/renderer/app.ts')], outfile: p('dist/renderer/app.js'), platform: 'browser', format: 'iife', target: 'chrome140' }),
  build({ ...common, entryPoints: [p('src/renderer/annotate.ts')], outfile: p('dist/renderer/annotate.js'), platform: 'browser', format: 'iife', target: 'chrome140' }),
  build({ ...common, entryPoints: [p('src/renderer/zoom-hud.ts')], outfile: p('dist/renderer/zoom-hud.js'), platform: 'browser', format: 'iife', target: 'chrome140' }),
  build({ ...common, entryPoints: [p('src/renderer/control-hud.ts')], outfile: p('dist/renderer/control-hud.js'), platform: 'browser', format: 'iife', target: 'chrome140' }),
  build({ ...common, entryPoints: [p('src/renderer/capture-frame.ts')], outfile: p('dist/renderer/capture-frame.js'), platform: 'browser', format: 'iife', target: 'chrome140' }),
  build({ ...common, entryPoints: [p('src/renderer/mobile-browser.ts')], outfile: p('dist/renderer/mobile-browser.js'), platform: 'browser', format: 'iife', target: 'chrome140' }),
  build({ ...common, entryPoints: [p('src/renderer/overlay.ts')], outfile: p('dist/renderer/overlay.js'), platform: 'browser', format: 'iife', target: 'chrome140' }),
]);

mkdirSync(p('dist/renderer'), { recursive: true });
cpSync(p('src/renderer/index.html'), p('dist/renderer/index.html'));
cpSync(p('src/renderer/overlay.html'), p('dist/renderer/overlay.html'));
cpSync(p('src/renderer/annotate.html'), p('dist/renderer/annotate.html'));
cpSync(p('src/renderer/zoom-hud.html'), p('dist/renderer/zoom-hud.html'));
cpSync(p('src/renderer/control-hud.html'), p('dist/renderer/control-hud.html'));
cpSync(p('src/renderer/capture-frame.html'), p('dist/renderer/capture-frame.html'));
cpSync(p('src/renderer/mobile-browser.html'), p('dist/renderer/mobile-browser.html'));
cpSync(p('src/renderer/styles.css'), p('dist/renderer/styles.css'));
cpSync(p('assets'), p('dist/assets'), { recursive: true });
console.log('build complete');
