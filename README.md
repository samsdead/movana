# Movana

A mobile-first dance coach with short lessons, original beats, and on-device movement feedback. Built with React, Vite, MediaPipe, and the Web Audio API.

[Try the live app](https://d2cxbgxgnz3xxl.cloudfront.net/)

## Run locally

Requires Node.js 22.12 or newer.

```sh
npm ci
npm run dev
```

The vision setup downloads and verifies the pinned pose model. Open the local URL printed by Vite.

## Test and build

```sh
npm test
python -m unittest discover -s tests -p '*_test.py'
npm run build
```

The production build prepares the camera assets, verifies the model checksum and checks that the published JavaScript and service worker have their camera files in `dist/`.

## Release and rollback

Update the CloudFormation stack in `us-east-1` before publishing assets. The deploy profile needs permission to verify bucket versioning, write the release and invalidate the distribution. The publish script requires an active CloudFront Free subscription and a verified build. It uploads versioned bundles and other assets before publishing the entrypoints. Run one publish at a time and save the three S3 version IDs printed for each release.

Use the saved version IDs to restore a previous release by copying its three entrypoint versions to the same keys. Restore `manifest.webmanifest` and `index.html` before `sw.js`, preserve the entrypoint cache and content-type metadata, then invalidate `/*` in CloudFront. Superseded object versions are retained for 30 days. Older current versions of content-addressed files stay available to clients and rollback releases. The first release after enabling versioning may have a preceding entrypoint with the version ID `null`.

With the default CloudFront hostname, AWS controls the viewer TLS policy. For TLS 1.2 or later on the public hostname, set `AppDomain` and `ViewerCertificateArn` together using a validated ACM certificate in `us-east-1` that covers the alias. Point the alias to the distribution and check the plan and certificate before cutover.

## Optional usage monitoring

Analytics defaults to off in the app and in the AWS stack. Keep it off until the public operator and privacy contact are established. If collection is enabled later, the browser still requires an explicit current consent choice and observes Do Not Track and Global Privacy Control. Use `VITE_ANALYTICS_ORIGIN=https://<your-hostname>` at build time for the matching custom domain.

The private usage dashboard shows aggregate WAF blocks, Lambda invocation volume and DynamoDB write throttles without enabling request sampling or access logs. With collection enabled, set `AnalyticsAlarmTopicArn` to an existing private SNS topic to receive aggregate alarms. Review the invocation threshold against expected traffic. The existing IP rate rule is shared with assets because the Free plan rejected an additional path-scoped rule. DynamoDB write capacity limits accepted writes, and the account's Lambda quota prevents reserved concurrency. Anonymous totals are estimates subject to automated submissions. Keep collection off if you need stronger abuse controls than the current plan supports.

## Credits

MediaPipe Tasks Vision and the PoseLandmarker Lite model are from Google ([Apache 2.0 licence](public/licenses/mediapipe.txt), [model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)). React and React DOM are by Meta and contributors ([MIT](public/licenses/react.txt)); Lucide uses the [ISC licence](public/licenses/lucide.txt); [Vite](https://github.com/vitejs/vite/blob/main/LICENSE) uses MIT. Fonts use SIL OFL 1.1: [DM Sans](public/fonts/DM-Sans-OFL.txt) and [Manrope](public/fonts/Manrope-OFL.txt). App photography depicts generated fictional dancers; music is synthesized from original patterns.
