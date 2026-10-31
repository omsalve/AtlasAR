# Atlas AR

A local-first, open-source prototype for creating interactive architectural experiences in a mobile browser. Author a property, configure viewpoints and points of interest, publish a snapshot, and open a reusable visitor experience with a 3D viewer and genuine image-target AR.

The prototype has no paid SDK, API key, cloud database, subscription, authentication service, or required hosting account. No deployment or purchase has been performed. Physical-device tracking remains a separate acceptance gate; see [testing status](docs/TESTING.md).

## Features and stack

- Original architectural GLB and furnished cutaway interior, with six explicitly named floor groups.
- Three.js orbit/pinch controls, zoom/reset, five configurable POIs, camera viewpoints, floor isolation, and separate interior inspection.
- MindAR image tracking with explicit camera initiation, searching/found/lost/error feedback, and conventional 3D fallback.
- Browser-local editor and Blob storage, validated versioned manifests, and independent published snapshots.
- Public-asset share links, downloadable QR codes, ZIP publication/backup packages, local target compilation and a sample target pair.

The QR opens the website; MindAR recognizes the separate configured image after camera permission is granted. The runtime does not infer a building from the image or fabricate an anchor over a camera feed.

The visitor has two flows. **Use a photo target** verifies an image from the phone, then opens the **live camera for free placement**. **Start camera AR** scans the physical target and keeps the building **anchored to that image**. Native WebXR offers real surface placement where supported; other browsers show a clearly labeled screen-relative manual preview. See [phone and Vercel instructions](docs/DEPLOYMENT.md).

The stack is Next.js static export, React, TypeScript, Three.js r160, MindAR 1.2.5 browser distributions, IndexedDB, `qrcode`, and `fflate`. Tracking code and Draco/Meshopt/KTX2 decoder assets are local. MindAR/Three versions are deliberately paired for compatibility.

The [research](docs/RESEARCH.md) compares current 8th Wall releases/licenses, MindAR, AR.js, WebXR, assets and hosting. Read the [architecture](docs/ARCHITECTURE.md) and [implementation plan](docs/IMPLEMENTATION_PLAN.md) for subsystem boundaries and acceptance criteria.

## Install and run

Use Node.js 24 LTS and npm. Initial installation needs internet. The viewer needs hardware-accelerated WebGL; AR also needs a camera and a trusted secure context.

```sh
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Workspace: `/`. Editor: `/editor/?project=<id>`. Visitor: `/experience/`, which defaults to the bundled Courtyard project.

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm start
```

The build creates static `out/`; `npm start` serves it, so build first. The export needs no Next server, database or serverless function. Actually executed checks are recorded in [TESTING.md](docs/TESTING.md).

Browser checks are available as `npm run test:browser`, `test:packages`, `test:static`, `test:ar`, and `test:compiler`. Install test Chromium once with `npx playwright install chromium`; point `TEST_URL` at your running server. See the testing guide for script defaults and ordering. Stop the development server before starting the static server on the same port.

Regenerate original geometry/thumbnails with `node scripts/generate-assets.mjs`. The script reloads exported GLBs to check finite bounds and floor names. It uses `sharp` from the installed dependencies.

## Author a property

1. Create a project from the workspace. Samples seed once rather than returning after every deletion.
2. Edit name, description and location. Choose bundled architecture or upload a model. Add a separate interior for apartment inspection.
3. Edit POI names, categories, descriptions, positions and camera destinations. Coordinates use Y-up, base Y=0 and a 12-unit maximum horizontal footprint. Capture the preview camera where offered to save a viewpoint.
4. Map floors to exact GLB node names. The sample uses `floor_0` through `floor_5`; arbitrary models have no automatic floor segmentation.
5. Assign both the image and matching compiled `.mind`. Compile replacement images before using them for AR.
6. Save, preview and publish a snapshot. Later draft changes require republishing to replace that saved snapshot.

Projects/uploads belong to the current browser profile and origin. Changing host, port, HTTP/HTTPS or profile uses different storage. Export backups before clearing browser data or moving machines. Private browsing, quotas and storage pressure can remove/prevent data. There is no cloud sync.

## Add models and targets

Prefer self-contained GLB 2.0, or glTF 2.0 with all buffers/textures embedded as supported data URIs. External `.bin`/texture references are rejected. Uploads and runtime downloads are limited to 25 MiB; aim below 10 MiB on mobile. Name floor roots before exporting and keep interiors separate.

Upload checks inspect the container/resource policy; Three.js then performs decoding. These checks are not a comprehensive hostile-model sanitizer or a guarantee that a 25 MiB asset fits every phone. See [asset conventions and optimization](docs/ASSET_PIPELINE.md).

The sample target is `public/assets/target.png`, paired with `target.mind`. Print/show the image on a second screen without cropping, stretching or glare. It is separate from the QR.

For a new target, choose a detailed, asymmetric PNG/JPEG/WebP. Avoid blank areas, repetitive patterns, transparency, reflective prints and QR-only images. The local compiler accepts 256–2048 pixels per dimension, at most 8 MiB, and requires at least 40 matching features. Keep the tab open and choose **Compile & use target**; the matching image and tracking data are saved together on this device. Save and republish. Separate preview uploads accept 128–4096 pixels, but changing a preview does not retrain an existing target.

Compiled targets use a supported MindAR v2 single-image envelope, at most 10 MiB. MindAR performs deeper loading. Compilation success does not establish physical recognition quality. See [upstream compiler documentation](https://hiukim.github.io/mind-ar-js-doc/tools/compile/).

## Phone and AR testing

1. Open a reachable **HTTPS** visitor URL in recent Safari/Chrome. Test actual iOS/Android devices before claiming audience support.
2. Place the configured target in even light or display it on another screen.
3. Start AR and grant camera access. Present the entire target; the model is visible only after real target-found callbacks.
4. Drag to rotate and pinch/use zoom buttons to scale. AR preserves the calibrated tracking camera. Interior inspection opens in conventional 3D.
5. Remove/return the target. Lost feedback must replace active feedback; the anchor hides during loss and is retained for reacquisition.
6. If denied, enable camera permission in browser site settings and retry. Use the 3D fallback for camera/tracking failures.

A phone's `localhost` means the phone, so a QR containing `http://localhost:3000` cannot reach the computer. For 3D on the same Wi-Fi:

```sh
npm run dev -- --hostname 0.0.0.0
```

Open `http://<computer-LAN-IP>:3000`, permitting the development port through the local firewall as needed. LAN HTTP normally does **not** satisfy camera secure-context requirements.

For local AR, generate a certificate covering that LAN hostname/IP and trust its certificate authority on the phone. Next supports:

```sh
npm run dev -- --hostname 0.0.0.0 --experimental-https --experimental-https-key ./certificates/dev-key.pem --experimental-https-cert ./certificates/dev-cert.pem
```

[mkcert instructions](https://github.com/FiloSottile/mkcert#readme) cover generation/mobile trust. Bypassing a certificate warning is not equivalent to a trusted secure context. Keep private keys local. Alternatively use a static HTTPS host with suitable current free terms. Local 3D authoring requires no host or tunnel.

## Share and publish

Choose a reachable origin in publication settings and generate its visitor URL/QR SVG. Large manifest links may exceed QR capacity; use a short static URL after hosting a package.

Projects using bundled/public HTTPS assets can travel in a compressed, validated `#p=` link. It contains project text/configuration; treat it as public. Remote assets need appropriate CORS. Links do not upload files or create hosting.

Uploaded `idb:` assets require a package on another device:

1. Export the ZIP.
2. Extract `projects/` into this app's `public/` before building, or into `out/` afterward.
3. Serve the **complete application** over HTTPS, including `assets/`, `vendor/`, `_next/` and `projects/`.
4. Share `https://<host>/experience/?project=<id>` and generate its QR.

The package contains `projects/<id>/project.json` plus uploaded assets. Bundled/HTTPS references remain references. Import the ZIP as a backup; an existing ID becomes a new copy rather than being overwritten. Exporting does not itself publish a website.

No deployment was performed. Optional [Cloudflare Pages Free limits](https://developers.cloudflare.com/pages/platform/limits/) checked on 31 October 2026 include 25 MiB/file, 20,000 files and 500 builds/month; [static requests](https://developers.cloudflare.com/pages/functions/pricing/) are currently free. Recheck terms before commercial use. GitHub Pages/Vercel Hobby commercial restrictions appear in [RESEARCH.md](docs/RESEARCH.md). No host is promised permanently free.

## Limits and zero-cost assumptions

- Single-browser authoring without authenticated ownership, team workspaces or cloud sync.
- In physical-target mode, the image must remain visible. Photo activation can use native WebXR surface tracking on supported browsers; the manual camera fallback is screen-relative. No universal SLAM SDK, room scanning, VPS or image-to-building reconstruction is included.
- Physical recognition, frame rate, memory and thermal behavior remain hardware acceptance gates. Emulation cannot establish them.
- No automated optimization service, arbitrary floor inference or first-person walkthrough. Files can exceed device capacity despite meeting byte limits.
- Origin-root hosting is assumed; subpath deployment needs coordinated Next base-path and public-asset changes.
- Existing hardware, electricity, internet, disk and host bandwidth are operating assumptions. No billing credential is configured.

Original samples are generated here. Retain their license and library notices when redistributing; upload only assets you may distribute. The project excludes the separately licensed proprietary 8th Wall SLAM binary.
