# Movana

A mobile-first dance coach with short lessons, original beats, and on-device movement feedback. Built with React, Vite, MediaPipe, and the Web Audio API.

[Try the live app](https://d2cxbgxgnz3xxl.cloudfront.net/)

## Run locally

Requires Node.js 22.12 or newer.

```sh
npm ci
npm run prepare:vision
npm run dev
```

The vision setup downloads and verifies the pinned pose model. Open the local URL printed by Vite.

## Test and build

```sh
npm test
npm run build
```

The production build is written to `dist/`.

## Credits

MediaPipe Tasks Vision and the PoseLandmarker Lite model are from Google ([Apache 2.0 licence](public/licenses/mediapipe.txt), [model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)). React and React DOM are by Meta and contributors ([MIT](public/licenses/react.txt)); Lucide uses the [ISC licence](public/licenses/lucide.txt); [Vite](https://github.com/vitejs/vite/blob/main/LICENSE) uses MIT. Fonts use SIL OFL 1.1: [DM Sans](public/fonts/DM-Sans-OFL.txt) and [Manrope](public/fonts/Manrope-OFL.txt). App photography depicts generated fictional dancers; music is synthesized from original patterns.
