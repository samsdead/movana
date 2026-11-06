import React from 'react';
import {COLLECTION_ENABLED} from './analytics.js';

export default function Privacy(){return <div className="privacy-policy">
  <p className="muted">Last updated 21 September 2026</p>
  <h3>Your camera stays with you</h3>
  <p>Camera access is optional. If you enable it, video frames and body landmarks are processed in your browser to estimate movement timing. We do not upload or record your video, audio, landmarks or scores. Camera access stops when you leave the studio or put the app in the background. You can also revoke access in your browser settings.</p>
  <h3>No microphone, accounts or ad pixels</h3>
  <p>Music is generated on your phone. Movana does not request microphone access, create user accounts, use advertising pixels, or build profiles about you.</p>
  <h3>Usage counts are optional</h3>
  <p>{COLLECTION_ENABLED?'Usage counts are off until you turn them on in Preferences. You can withdraw that choice there at any time.':'Usage collection is currently disabled. Opening lessons or using the camera does not send usage events.'} Browser Do Not Track and Global Privacy Control signals also prevent submission.</p>
  <p>If collection is made available and you choose to enable it, we count visits, lesson opens, starts, completions and practice seconds to improve lessons, plus broad campaign labels to understand which promotions bring visits. We store daily totals, without visitor IDs, cookies, scores or referrers. These are activity counts, not unique people. Totals expire after 90 days; deletion can take a few additional days. Events are not queued for later upload.</p>
  <h3>What stays in your browser</h3>
  <p>Your chosen preferences and privacy choice are stored locally. App files may be cached for offline use. Tracking files download only when you enable the camera. Reset preferences to remove your choices; use your browser’s Clear site data control to remove cached files too. Session results disappear when you leave the studio.</p>
  <h3>Hosting and international processing</h3>
  <p>Amazon Web Services receives connection information, including IP addresses and request headers, to deliver and protect the app. Our app access logs and WAF request sampling are disabled. CloudFront delivers files through a global network; the statistics infrastructure is in US East (N. Virginia). Keeping camera processing on your device does not mean hosting involves no personal information.</p>
  <h3>Your choices and rights</h3>
  <p>You can use all lessons without camera access or usage counts. Where data-protection law applies, rights can include information, access, correction, deletion, restriction, objection and withdrawal of consent. We cannot identify your activity within anonymous totals and will not collect extra identifying data just to do so. You can complain to your local supervisory authority; in the UK this is the <a href="https://ico.org.uk/make-a-complaint/" rel="noreferrer">Information Commissioner’s Office</a>.</p>
  <p className="muted">Movana is a preview. The public operator and privacy-contact details still need to be established before a wider launch. Optional collection stays disabled while that is unresolved.</p>
</div>;}
