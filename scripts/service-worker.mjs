import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const entries=await readdir('dist',{recursive:true,withFileTypes:true});
const files=entries.filter(e=>e.isFile()).map(e=>(e.parentPath+'/'+e.name).replaceAll('\\','/').replace(/^dist\//,'/')).filter(path=>path!=='/sw.js');
const assets=files.filter(path=>!path.includes('/mediapipe/')&&!path.includes('/models/'));
const version=createHash('sha256').update(await readFile('dist/index.html')).digest('hex').slice(0,12);
await writeFile('dist/sw.js',`const CACHE='movana-${version}';
const CORE=${JSON.stringify(['/',...assets])};
const ASSETS=new Set(${JSON.stringify(files)});
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('movana-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  const navigation=event.request.mode==='navigate'&&(url.pathname==='/'||url.pathname==='/index.html');
  if(!navigation&&!ASSETS.has(url.pathname))return;
  // Only known build files enter the cache. Query strings never become cache keys.
  const key=navigation?'/index.html':url.pathname;
  event.respondWith(caches.open(CACHE).then(async cache=>{
    const cached=await cache.match(key);if(cached&&!navigation)return cached;
    try{const response=await fetch(key,{credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',...(navigation?{cache:'no-cache'}:{})});if(response.ok&&response.type==='basic'){try{await cache.put(key,response.clone());}catch{}}return response;}
    catch(error){if(cached)return cached;throw error;}
  }).catch(()=>fetch(event.request)));
});
`);
console.log(`Offline worker: ${assets.length} core assets; model and WASM cached after first use.`);
