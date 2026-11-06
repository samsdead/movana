// First-party daily counters only. No cookies, identifiers, scores or movement data.
const SOURCES={google:'google',microsoft:'microsoft',bing:'microsoft',reddit:'reddit',facebook:'meta',instagram:'meta',meta:'meta',chatgpt:'chatgpt'};
// Keep collection paused until the public controller notice is complete.
export const COLLECTION_ENABLED=false;
export const CONSENT_VERSION=2;
let pagePreference;
export function setUsagePreference(enabled){pagePreference=enabled===true;}
export function browserOptOut(){return navigator.doNotTrack==='1'||window.doNotTrack==='1'||navigator.globalPrivacyControl===true;}
export function campaignSource(){const source=new URLSearchParams(location.search).get('utm_source');return source?(SOURCES[source.toLowerCase()]||'other'):'direct';}
export function trackingAllowed(){
  if(!COLLECTION_ENABLED||browserOptOut())return false;
  if(pagePreference!==undefined)return pagePreference;
  try{const saved=JSON.parse(localStorage.getItem('movana-settings')||'{}');return saved?.analytics===true&&saved?.analyticsConsent===CONSENT_VERSION;}catch{return false;}
}
export async function track(event,details={}){
  if(!import.meta.env.PROD||location.hostname!=='d2cxbgxgnz3xxl.cloudfront.net'||!trackingAllowed())return;
  try{
    const body=JSON.stringify({event,consent:CONSENT_VERSION,...details});
    // CloudFront's private Lambda origin signs POST requests using this body hash.
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body));
    if(!trackingAllowed())return;
    const digest=Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
    await fetch('/events',{method:'POST',credentials:'omit',mode:'cors',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',keepalive:true,headers:{'Content-Type':'application/json','x-amz-content-sha256':digest},body});
  }catch{/* Analytics must never interrupt a lesson; offline events are not queued. */}
}
