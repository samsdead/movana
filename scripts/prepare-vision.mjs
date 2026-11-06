import {cp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
await mkdir('public/models',{recursive:true});
await cp('node_modules/@mediapipe/tasks-vision/wasm','public/mediapipe/wasm',{recursive:true});
const model='public/models/pose_landmarker_lite.task';
let buffer;try{buffer=await readFile(model);}catch{
  const response=await fetch('https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task');
  if(!response.ok)throw new Error(`Model download failed: ${response.status}`);
  buffer=Buffer.from(await response.arrayBuffer());await writeFile(model,buffer);
}
if(buffer.length<1_000_000)throw new Error('Model download is incomplete.');
if(createHash('sha256').update(buffer).digest('hex')!=='59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a')throw new Error('Pose model checksum does not match the pinned asset.');
console.log(`Local pose model: ${buffer.length} bytes; SHA256 ${createHash('sha256').update(buffer).digest('hex')}`);
