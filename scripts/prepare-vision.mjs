import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { modelName, modelSha256, sdkWasmDirectory, verifyModel, visionRoot, wasmFiles } from './vision-assets.mjs';

const directory = `public/${visionRoot}`;
const destination = `${directory}/${modelName}`;
let model;
for (const path of [destination, `public/models/${modelName}`]) {
  try {
    model = await readFile(path);
    break;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
if (!model) {
  const response=await fetch('https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task');
  if(!response.ok)throw new Error(`Model download failed: ${response.status}`);
  model = Buffer.from(await response.arrayBuffer());
}
verifyModel(model);
await mkdir(`${directory}/wasm`, { recursive: true });
await writeFile(destination, model);
await Promise.all(wasmFiles.map(file => copyFile(`${sdkWasmDirectory}/${file}`, `${directory}/wasm/${file}`)));
console.log(`Prepared ${model.length} model bytes with SHA-256 ${modelSha256} and the locked MediaPipe WASM files.`);
