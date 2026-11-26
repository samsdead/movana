import { readdir, readFile } from 'node:fs/promises';
import { verifyVision, visionRoot } from './vision-assets.mjs';

await verifyVision('dist');
const html = await readFile('dist/index.html', 'utf8');
const worker = await readFile('dist/sw.js', 'utf8');
const bundles = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(match => match[1]);
if (!bundles.some(path => path.endsWith('.js'))) throw new Error('Missing production JavaScript entrypoint.');
for (const path of bundles) await readFile(`dist${path}`);
const bundleFiles = (await readdir('dist/assets')).filter(file => file.endsWith('.js'));
const bundleSources = await Promise.all(bundleFiles.map(file => readFile(`dist/assets/${file}`, 'utf8')));
const visionPath = `/${visionRoot}/`;
if (!bundleSources.some(source => source.includes(visionPath)) || !worker.includes(visionPath)) {
  throw new Error('The JavaScript build and service worker must both reference the verified camera assets.');
}
JSON.parse(await readFile('dist/manifest.webmanifest', 'utf8'));
console.log('Verified the production entrypoints and pinned camera assets.');
