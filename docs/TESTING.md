# Testing and acceptance record

Verified 31 October 2026. The local MVP is implemented. Automated browser evidence and physical-device acceptance are separate; no physical phone or printed-target result is claimed.

## Executed checks

| Check | Result | Evidence / scope |
|---|---|---|
| Data/schema/assets/publication and surface policy tests | **21 passed** | `npm test`, Node test runner; includes stability, jitter, invalid hits, tracking gaps and slow frame rates |
| TypeScript | **Passed** | `npm run typecheck` |
| ESLint | **Passed** | `npm run lint`; generated output and retained upstream vendors excluded |
| Production static build | **Passed** | `npm run build`; workspace/editor/experience/icon exported into `out/`, no build warnings |
| Desktop/mobile browser workflow | **12 passed, no page/console errors** | `npm run test:browser` against production static server; `.artifacts/browser-results.json` |
| Upload/package/persistence workflow | **7 passed, no page errors** | `npm run test:packages`; `.artifacts/browser-packages-results.json` |
| Static publishing and failures | **7 passed** | `npm run test:static`; `.artifacts/browser-static-results.json` |
| Sample target compilation | **Passed** | Real browser compiler: 2,470 matching features, 565,732-byte `.mind` |
| Image-target AR regression | **11 passed, no page errors** | `npm run test:ar` against production; `.artifacts/ar-synthetic-results.json` |
| Editor target-compiler workflow | **3 passed, no page errors** | `npm run test:compiler`; actual iframe compilation in 17 seconds, matching Blob pair, save/reload; `.artifacts/browser-compiler-results.json` |
| Photo verification -> live placement | **7 passed, no page errors/uploads** | Real target matching gates a live stream; blank/invalid rejection, controls, portrait/square, stream cleanup and denied camera; `.artifacts/browser-photo-results.json` |
| WebXR request/fallback integration | **4 passed, no page errors** | Actual photo matching/camera; injected XR request refusal verifies trusted-click arguments, stream exclusivity and recovery; `.artifacts/browser-placement-results.json` |
| Synthetic WebXR surface policy/lifecycle | **13 passed, no page errors** | `npm run test:surface`; explicitly synthetic XR session/hits/anchor poses; `.artifacts/browser-surface-results.json`; does not establish physical tracking quality |
| Physical iOS/Android camera and print recognition | **Not performed** | No connected physical test device |
| Real mobile FPS, memory and thermals | **Not performed** | Desktop emulation cannot establish these |

The 12 smoke checks cover seeded workspace, search/filter, create, actual WebGL building load, actual camera movement from zoom/drag, save/reload, POI edit/camera capture, floor selection/interior switching, snapshot/QR generation, published scene content, 390 x 844 layout, and explicit AR entry. Screenshots were visually reviewed at 1440 x 1000 and 390 x 844. The viewer shows loading feedback while its engine chunk/model loads.

The seven package checks upload a real GLB into IndexedDB, reload/render it, reject an arbitrary renamed GLB, export a ZIP, preserve an earlier published snapshot during later draft edits, import a copy with a new ID/Blob, and reload/render that restored project.

Static tests copy the exported manifest/assets into the built output, then use a fresh browser context. The visitor renders the uploaded model without opening the editor database. They also download a real QR SVG, open a portable manifest link in an independent profile, reject a malformed link and unsupported schema, and verify missing-model feedback plus an actual retry request. QR encoding uses the exact displayed URL; physical QR scanning/independent optical decoding was not performed.

## AR evidence and limits

The AR test uses **actual MindAR feature matching and tracking**, with a Y4M synthetic camera containing target -> blank -> target frames. It does not fire callbacks by hand or mock recognition. It verifies target recognition, a rendered anchor canvas, POI/floor/scale controls, truthful loss, reacquisition, exit, ended camera tracks, a genuine browser camera-permission denial, and the 3D fallback. Evidence includes `ar-tracked-synthetic.png` and `ar-target-lost-synthetic.png` in `.artifacts`.

A TensorFlow cleanup error discovered during testing was fixed after inspecting the upstream TensorInfo lifecycle. The rerun has no uncaught errors and all camera tracks end after exit. Chromium 156 reported `NotSupportedError` even when its camera permission was actually denied; startup handling now checks the Permissions API where available and retains native-error fallback on other browsers. No browser sniff or simulated rejection is used for that denial test. Editor compilation initially stalled in an offscreen frame outside the modal; moving its visible progress frame inside the active dialog fixed the actual UI workflow, including paired-asset save/reload.

The target follows its image plane. A tabletop target yields a building standing off that plane; a vertical poster yields a model projecting from the poster normal. This is not gravity-aware world tracking. Loss feedback begins after MindAR's configured five-frame miss tolerance; the hidden scene is retained for recovery. The initial AR footprint is approximately half the target width to reduce perspective clipping.

Remaining unverified cases include real touch/pinch feel, rapidly interrupting camera transitions on hardware, portrait/landscape behavior on iOS/Android, weak/glossy prints, busy/unplugged cameras, insecure-origin fallback on a physical phone, storage quota/disabled-storage behavior, hostile decoder fuzzing, every Draco/KTX2 compression combination, and representative large-model GPU performance. Error paths are implemented; these cases are not claimed as passed.

## Reproduce

```sh
npm install
npx playwright install chromium
npm test
npm run typecheck
npm run lint
npm run build
npm start
```

In another terminal, run `npm run test:browser`, `npm run test:packages`, `npm run test:static`, `npm run test:ar`, and `npm run test:compiler`. Browser/static/AR/package scripts accept `TEST_URL`. The smoke/package/AR scripts default to port 3000; static/compiler default to port 3001. Set the variable consistently for your running server (PowerShell example: `$env:TEST_URL='http://localhost:3000'`). Run package tests before static tests, which use their generated ZIP. Run the AR suite alone for stable timing. Generated screenshots, ZIPs, synthetic video and JSON results are ignored under `.artifacts/`.

The synthetic fixture is approximately 110 MB on disk. No camera recording, API keys, external accounts, paid tools or public deployment are used in these tests.

## Physical-device release gate

Record device model, OS/browser, HTTPS origin, target revision, print width, lighting and distance. Test both iOS Safari and Android Chrome with a matte print and another screen:

1. Scan QR and open a reachable HTTPS visitor URL without installing an app.
2. Deny camera permission, verify recovery guidance, then allow it and retry.
3. Present the complete target; record acquisition time and alignment while moving slowly.
4. Rotate/pinch, select POIs/floors, enter/exit the interior, and change orientation.
5. Remove, occlude and return the target; verify honest loss and reacquisition.
6. Exit/re-enter AR and confirm the camera indicator stops on exit.
7. Test multiple minutes with a realistic optimized asset; record frame rate, crashes, memory pressure and heat.

Physical-device release acceptance remains open. Automated synthetic tracking establishes a functioning tracking integration, not universal device compatibility or production readiness.

## Photo activation and free placement

Photo input now verifies the configured target and opens the live camera only after a genuine match. It does not display the model over the selected image. Tests count and delegate native getUserMedia: blank/invalid photos make zero requests, each valid photo makes one, and exit ends every track. Portrait and square target photos activate new streams. The selected photo is not uploaded and its pose/canvas is discarded before live placement starts.

Manual preview is clearly screen-relative. WebXR placement code uses native plane hit testing, a stabilized reticle, optional anchors and a local reference space. `test:placement` injects only an available XR system whose requestSession always rejects: it verifies immersive-ar, required hit-test/dom-overlay, a connected UI-only overlay, active user gesture, ended manual tracks before requesting, and a new manual stream after refusal.

The separate `test:surface` harness supplies an explicitly **synthetic** successful XR session, frames, hit results and anchor poses to the real application/Three renderer. It verifies rejection of invalid, tilted, distant and emulated poses; stability before automatic placement; jump rejection; 10 fps acquisition; tap confirmation with fresh-hit validation; viewer/anchor tracking loss; anchored and unanchored reference resets; anchor refusal; late-anchor deletion after reposition/exit; and session/source/camera cleanup. It also captures portrait and short-landscape controls. The fixture checks that anchor creation occurs during its active synthetic frame. These results verify policy and lifecycle, not a real detector or tracking accuracy. Actual native surface placement remains a physical-device acceptance gate. See [research, tuning and device steps](SURFACE_PLACEMENT.md).
