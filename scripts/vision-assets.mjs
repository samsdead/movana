import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import lockfile from '../package-lock.json' with { type: 'json' };

export const modelName = 'pose_landmarker_lite.task';
export const modelSha256 = '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a';
const sdkIntegrity = lockfile.packages['node_modules/@mediapipe/tasks-vision'].integrity;
if (!sdkIntegrity) throw new Error('MediaPipe has no pinned npm integrity hash.');
export const visionRoot = `assets/vision/${createHash('sha256').update(`${sdkIntegrity}:${modelSha256}`).digest('hex').slice(0, 32)}`;
export const sdkWasmDirectory = 'node_modules/@mediapipe/tasks-vision/wasm';
export const wasmFiles = [
  'vision_wasm_internal.js', 'vision_wasm_internal.wasm',
  'vision_wasm_module_internal.js', 'vision_wasm_module_internal.wasm',
  'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm',
];

export function verifyModel(model) {
  if (createHash('sha256').update(model).digest('hex') !== modelSha256) {
    throw new Error('Pose model checksum does not match the pinned asset.');
  }
}

export async function verifyVision(prefix) {
  const root = `${prefix}/${visionRoot}`;
  verifyModel(await readFile(`${root}/${modelName}`));
  for (const file of wasmFiles) {
    const [built, installed] = await Promise.all([
      readFile(`${root}/wasm/${file}`), readFile(`${sdkWasmDirectory}/${file}`),
    ]);
    if (!built.length || !built.equals(installed)) {
      throw new Error(`Built camera asset does not match locked MediaPipe: ${file}`);
    }
  }
}
