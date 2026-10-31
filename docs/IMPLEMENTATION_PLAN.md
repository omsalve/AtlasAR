# Implementation plan and final status

Established before application changes on 31 October 2026. Research, architecture and acceptance criteria were written before implementation. The existing Next.js/npm starter was extended without modifying unrelated projects. No purchase, service signup or public deployment was performed.

| Milestone | Objective / modules | Dependencies and risks | Acceptance and verification | Status |
|---|---|---|---|---|
| 0. Inspect | Repository, Git state, Node/npm, local Next guides | Starter is untracked within parent repository; preserve siblings | Node24/npm11, Next16.4.3/React19.3 identified; relevant client/static/lazy/CLI guides read | Complete |
| 1. Research and plan | RESEARCH, ARCHITECTURE, this plan | Current licenses, prereleases, hosting terms | Primary 8th Wall MIT/binary licenses, alternatives, assets and hosting compared | Complete |
| 2. Foundation | project schema, scene loader, original assets, viewer | WebGL/device memory and unsafe/oversized assets | Real GLBs exported/reloaded; actual browser render, camera zoom/drag, validation/errors/retry passed | Implemented and locally verified |
| 3. Architecture interaction | POIs, camera motion, floor mapping, interior | Floors require named roots; transitions must cancel | Five editable POIs, capture/viewpoints, sample floor isolation, separate interior open/return; browser workflow passed | Implemented and browser verified; hardware feel remains open |
| 4. Image-target AR | ar-view, compiler, local MindAR artifacts | Secure camera, target quality, lifecycle, mobile support | Real synthetic recognition/loss/reacquisition, POI/floor/scale, camera stop/denial/fallback; editor compilation/save/reload passed | Implemented; synthetic/browser verified; physical release gate open |
| 5. Configuration | editor, validation, IndexedDB/assets | Browser quota, eviction, malformed uploads | Create/edit/save/reload; GLB and paired target Blobs persist; ZIP import creates a copy | Implemented and browser verified |
| 6. Sharing | snapshots, manifests, QR, ZIP/static package | Local uploads do not synchronize; HTTPS origin needed | Snapshot immutability, SVG download, clean-profile portable URL and uploaded static-package rendering passed | Implemented and static-server verified; no public hosting claimed |
| 7. Validate/document | tests, screenshots, README and guides | Physical cameras/realistic mobile assets unavailable | Build/type/lint, 10 unit checks, 12 smoke, 7 package, 7 static, 11 AR and 3 compiler checks passed | Local verification complete; physical/device/performance acceptance remains open |

Shared data/asset contracts were established before parallel viewer/editor/AR work. This is the only significant ordering adjustment to the brief.

## Acceptance record

- [x] Actual GLB load, rotation/zoom, resize and useful missing/invalid model feedback with retry.
- [x] Five configurable POIs, camera capture/selection and overview return.
- [x] Explicit floor roots and separate interior load/return.
- [x] Genuine image-target engine; original printable target; local compilation through the editor.
- [x] Real synthetic recognition, honest loss/recovery, actual denied permission, stopped camera tracks and 3D fallback.
- [x] Create/save/reload, separate published snapshot, model and paired image/target persistence.
- [x] Runtime schema/asset validation and bounded model downloads.
- [x] Portable project links, QR SVG generation/download and complete uploaded-asset ZIP packages.
- [x] Fresh-profile static package/manifest/asset rendering without editor storage.
- [x] Desktop and mobile viewport screenshots reviewed; no horizontal overflow at 390 x 844.
- [x] TypeScript, lint, production static build and automated suites pass.
- [ ] Physical iOS Safari/Android Chrome camera, matte-print recognition/alignment and reacquisition.
- [ ] Real phone touch/pinch/orientation/thermal/memory/FPS behavior with realistic assets.
- [ ] Optical QR scan, poor-light/glare/blur behavior, quota exhaustion and full decoder/hostile-model testing.

Testing found and fixed a TensorFlow disposal error, a Chromium denied-permission error-name edge case, an offscreen-frame compiler stall, and stale configuration after same-page fragment changes. Reruns exercise the real underlying browser and tracker. No mocks replace recognition.

The deliverable is a functioning local-first MVP with explicit physical-device release gates. It has no authenticated multiuser backend, cloud sync, universal SLAM SDK, automated optimization service or first-person walkthrough. See TESTING.md for exact evidence and remaining limits.

## Follow-up: two target-input flows

- Implemented gallery-photo recognition as an activation-only step; the photo and its pose are discarded before opening the live camera.
- Preserved physical image scanning and image-anchored rendering as a separate path.
- Added live manual camera placement plus capability-detected native WebXR surface placement. Manual mode does not claim world tracking.
- Seven real photo/camera workflow checks and four native-request refusal/recovery checks pass. Physical surface tracking and phone optics/performance remain unverified.
- Added explicit Vercel static-build configuration; no deployment or paid hosting was performed.
