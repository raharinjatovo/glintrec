import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDst = join(root, 'assets', 'mediapipe', 'wasm');
const modelDst = join(root, 'assets', 'mediapipe', 'selfie_segmenter.tflite');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

if (!existsSync(wasmSrc)) {
  console.error('Run `npm install` first: ' + wasmSrc + ' not found');
  process.exit(1);
}
mkdirSync(wasmDst, { recursive: true });
cpSync(wasmSrc, wasmDst, { recursive: true });
console.log('Copied wasm ->', wasmDst);

if (existsSync(modelDst) && statSync(modelDst).size > 100 * 1024) {
  console.log('Model already present:', modelDst);
} else {
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length <= 100 * 1024) throw new Error('downloaded file too small: ' + buf.length);
    mkdirSync(dirname(modelDst), { recursive: true });
    writeFileSync(modelDst, buf);
    console.log('Downloaded model', buf.length, 'bytes ->', modelDst);
  } catch (e) {
    console.error('Model download failed: ' + e.message);
    console.error('Manually download ' + MODEL_URL + '\nand save it as ' + modelDst);
    process.exit(1);
  }
}
