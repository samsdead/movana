import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';

const source=(await readFile(new URL('../src/analytics.js',import.meta.url),'utf8')).replaceAll('export ','').replaceAll('import.meta.env.PROD','true');
function fixture({settings='{"analytics":true,"analyticsConsent":2}',dnt='0',gpc=false,search='',host='d2cxbgxgnz3xxl.cloudfront.net',protocol='https:',allowedOrigin,enabled=true}={}){
  const requests=[];
  const scope={navigator:{doNotTrack:dnt,globalPrivacyControl:gpc},window:{},location:{origin:protocol+'//'+host,protocol,search},localStorage:{getItem:()=>settings},URLSearchParams,TextEncoder,crypto:webcrypto,fetch:async(...args)=>{requests.push(args);return {status:204};}};
  const api=runInNewContext(source.replace('import.meta.env.VITE_ANALYTICS_ORIGIN','allowedOrigin').replace('const COLLECTION_ENABLED=false','const COLLECTION_ENABLED='+enabled)+';({track,campaignSource,trackingAllowed,setUsagePreference});',{...scope,allowedOrigin});
  return {api,requests,writeSettings(value){settings=value;}};
}
test('analytics respects saved opt-out and browser privacy signals',async()=>{
  for(const options of [{enabled:false},{settings:'{}'},{settings:'{"analytics":true}'},{settings:'{"analytics":true,"analyticsConsent":1}'},{settings:'{"analytics":false}'},{dnt:'1'},{gpc:true},{host:'localhost'},{settings:'broken-json'}]){const f=fixture(options);await f.api.track('visit',{source:'direct'});assert.equal(f.requests.length,0);}
});
test('withdrawal is immediate and opt-in must be stored at the current version',async()=>{
  const f=fixture();f.api.setUsagePreference(false);await f.api.track('visit',{source:'direct'});assert.equal(f.requests.length,0);
  f.writeSettings('{"analytics":true}');f.api.setUsagePreference(true);await f.api.track('visit',{source:'direct'});assert.equal(f.requests.length,0);
  f.writeSettings('{"analytics":true,"analyticsConsent":2}');await f.api.track('visit',{source:'direct'});assert.equal(f.requests.length,1);
  const privateBrowser=fixture({gpc:true});privateBrowser.api.setUsagePreference(true);assert.equal(privateBrowser.api.trackingAllowed(),false);
});
test('a different tab can withdraw consent before an in-flight digest completes',async()=>{
  const f=fixture();
  f.api.setUsagePreference(true);
  const event=f.api.track('visit',{source:'direct'});
  f.writeSettings('{"analytics":false}');
  await event;
  assert.equal(f.requests.length,0);
  assert.equal(f.api.trackingAllowed(),false);
});
test('analytics uses only the configured HTTPS origin',async()=>{
  const allowedOrigin='https://dance.example';
  for(const options of [{host:'dance.example'},{host:'dance.example',allowedOrigin,protocol:'http:'},{allowedOrigin}]){
    const f=fixture(options);await f.api.track('visit',{source:'direct'});assert.equal(f.requests.length,0);
  }
  const f=fixture({host:'dance.example',allowedOrigin});await f.api.track('visit',{source:'direct'});assert.equal(f.requests.length,1);
});
test('anonymous events stay same-origin, without cookies or referrer, with a valid body hash',async()=>{
  const f=fixture();await f.api.track('session_start',{lesson:'salsa'});assert.equal(f.requests.length,1);
  const [url,request]=f.requests[0];assert.equal(url,'/events');assert.equal(request.credentials,'omit');assert.equal(request.referrerPolicy,'no-referrer');assert.equal(request.mode,'cors');assert.equal(request.redirect,'error');
  assert.deepEqual(JSON.parse(request.body),{event:'session_start',consent:2,lesson:'salsa'});
  const hash=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(request.body))).toString('hex');assert.equal(request.headers['x-amz-content-sha256'],hash);
});
test('campaign sources never forward arbitrary query values or identifiers',()=>{
  assert.equal(fixture({search:'?utm_source=google'}).api.campaignSource(),'google');assert.equal(fixture({search:'?utm_source=private@example.com&gclid=secret'}).api.campaignSource(),'other');assert.equal(fixture().api.campaignSource(),'direct');
  assert.equal(fixture({search:'?utm_source=__proto__'}).api.campaignSource(),'other');
});
