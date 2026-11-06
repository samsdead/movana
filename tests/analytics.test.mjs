import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';

const source=(await readFile(new URL('../src/analytics.js',import.meta.url),'utf8')).replaceAll('export ','').replaceAll('import.meta.env.PROD','true');
function fixture({settings='{"analytics":true,"analyticsConsent":2}',dnt='0',gpc=false,search='',host='d2cxbgxgnz3xxl.cloudfront.net',enabled=true}={}){
  const requests=[];
  const scope={navigator:{doNotTrack:dnt,globalPrivacyControl:gpc},window:{},location:{hostname:host,search},localStorage:{getItem:()=>settings},URLSearchParams,TextEncoder,crypto:webcrypto,fetch:async(...args)=>{requests.push(args);return {status:204};}};
  const api=runInNewContext(source.replace('const COLLECTION_ENABLED=false','const COLLECTION_ENABLED='+enabled)+';({track,campaignSource,trackingAllowed,setUsagePreference});',scope);return {api,requests};
}
test('analytics respects saved opt-out and browser privacy signals',async()=>{
  for(const options of [{enabled:false},{settings:'{}'},{settings:'{"analytics":true}'},{settings:'{"analytics":true,"analyticsConsent":1}'},{settings:'{"analytics":false}'},{dnt:'1'},{gpc:true},{host:'localhost'},{settings:'broken-json'}]){const f=fixture(options);await f.api.track('visit',{source:'direct'});assert.equal(f.requests.length,0);}
});
test('a changed preference applies even when storage cannot be updated',async()=>{
  const f=fixture({settings:'{"analytics":true}'});f.api.setUsagePreference(false);await f.api.track('visit',{source:'direct'});assert.equal(f.requests.length,0);
  f.api.setUsagePreference(true);await f.api.track('visit',{source:'direct'});assert.equal(f.requests.length,1);
  const privateBrowser=fixture({gpc:true});privateBrowser.api.setUsagePreference(true);assert.equal(privateBrowser.api.trackingAllowed(),false);
});
test('anonymous events stay same-origin, without cookies or referrer, with a valid body hash',async()=>{
  const f=fixture();await f.api.track('session_start',{lesson:'salsa'});assert.equal(f.requests.length,1);
  const [url,request]=f.requests[0];assert.equal(url,'/events');assert.equal(request.credentials,'omit');assert.equal(request.referrerPolicy,'no-referrer');assert.equal(request.mode,'cors');assert.equal(request.redirect,'error');
  assert.deepEqual(JSON.parse(request.body),{event:'session_start',consent:2,lesson:'salsa'});
  const hash=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(request.body))).toString('hex');assert.equal(request.headers['x-amz-content-sha256'],hash);
});
test('campaign sources never forward arbitrary query values or identifiers',()=>{
  assert.equal(fixture({search:'?utm_source=google'}).api.campaignSource(),'google');assert.equal(fixture({search:'?utm_source=private@example.com&gclid=secret'}).api.campaignSource(),'other');assert.equal(fixture().api.campaignSource(),'direct');
});
