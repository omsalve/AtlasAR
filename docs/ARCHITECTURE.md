# Architecture

## Decisions and boundaries

The existing Next.js 16.4.3 / React 19.3 / npm starter is extended. Local Next documentation for client components, lazy loading and static export was read before code. Client-only WebGL/IndexedDB/camera are initialized after mount. A static export avoids any required server or paid service. Camera starts only after an explicit visitor action.

### Experience editor

`components/workspace.tsx` owns the dashboard, project forms and publication UI. It edits a versioned `Project` from `lib/project.ts`, supports multiple properties, model/target/compiled-target uploads, five editable POIs, camera destinations, floor node mapping, preview, snapshots and QR export. A shared viewer provides immediate preview. Assets are Blobs, never executable uploads. Forms and safe React text rendering replace HTML injection.

### Experience runtime

`components/experience.tsx` loads a validated manifest independently of editor state. `components/viewer.tsx` owns normal Three.js rendering, OrbitControls, resizing, floor visibility, interruptible POI camera motion, overview and separately loaded interior. `components/ar-view.tsx` is a lazy-loaded MindAR adapter. `lib/scene.ts` shares model loading, normalization, disposal and floor logic. The normal viewer moves its camera; AR always preserves MindAR's calibrated tracking camera and rotates/scales only a model wrapper. Model coordinates are normalized to a common 12-unit footprint; camera/POI positions use this coordinate system.

Visitor activation has two independent paths. Physical camera scanning uses MindAR's tracked image anchor. A gallery photo goes through `lib/recognize-photo.ts`, which returns only a boolean from actual matching, then disposes the recognition context and photo canvas. A successful match mounts `components/free-placement.tsx` and automatically starts the live camera. No image pose is transferred. Manual placement is explicitly screen-relative. Where supported, a fresh user tap requests native WebXR hit-test/DOM-overlay placement in local session coordinates. Camera streams and native XR sessions are mutually exclusive; refusal recovers manual preview. The photo and live streams are not uploaded.

Tracking states: idle → initializing → requesting-camera → searching → tracking → lost → tracking; denied/unsupported/error have an actionable 3D fallback. Found/lost callbacks are the source of truth. Lost anchors are hidden and resources retained for reacquisition. No world pose persistence or fake recognition overlay. Stop clears animation loops, video tracks, renderer and scene. User UI touches do not bubble into model gestures.

### Asset pipeline

`lib/assets.ts` validates extension, byte size and actual structure. Models are <=25MiB, preferably <10MiB; JSON and image dimensions are bounded. Runtime downloads enforce the same 25MiB limit and a 45-second timeout before validation/GLTFLoader parsing, including shared HTTPS assets. GLB container, embedded-resource policy and URL schemes are checked, without claiming comprehensive decoder security. The original asset generator outputs real building/interior GLBs and previews with `floor_0`…`floor_5`. The target compiler runs inside a visible, disposable same-origin frame in its native dialog; it saves the exact image and compiled `.mind` together. Cancel/finish removes the frame and its workers. Weak targets can still compile; physical recognition needs testing.

## Data and persistence

Project schema version 1 includes id, name, description, location, timestamps, status, model reference, separate interior model reference, overview camera, AR image and `.mind` references/scale, floor mappings, and POIs (id, name, category, position, camera, description, optional media/interior flag). Runtime validation checks bounds, finite vectors, unique IDs, supported version and safe URLs. No arbitrary script/HTML fields.

`lib/storage.ts` exposes project list/get/save and asset put/get/resolve; the runtime consumes the same manifest and an asset resolver. `idb:` references resolve to temporary Blob URLs in the current origin. Ordinary `/assets/...` or HTTPS references are portable. IndexedDB failure/quota errors are visible; export provides backups. There is no cloud sync, authentication, team collaboration, analytics or billing in this MVP.

## Publication

Default sample is available at `/experience/`. Local project snapshots persist separately from edits. Compact validated manifests in URL fragments share projects using public/static assets. Local Blob references do not become public from a QR code. An export package contains a manifest and uploaded assets with rewritten relative paths. Copy its `projects/` directory into `public/` before build (or into static `out/` after build); `/experience/?project=<id>` loads `/projects/<id>/project.json`. QR uses the selected HTTPS origin and that URL. Built-in sample links work on another device when the app is hosted. Public publication is an explicit filesystem/hosting step; the UI describes local preview honestly.

## Rendering and interaction

Normal-viewer pixel ratio <=1.75, AR <=2; shadow maps bounded; building and interior load on demand. No dashboard WebGL contexts: covers use original sample illustrations. Normal viewer supports mouse/touch OrbitControls and keyboard-accessible zoom/reset controls. POI motion starts from the current camera, cancels on pointer/controls input, and respects reduced motion. A native full-screen AR dialog manages focus; the normal viewer unmounts while AR owns the camera/rendering. AR uses model yaw/pinch/scale and POI descriptions/highlights without moving the tracking camera. Interior exploration returns to conventional 3D.

## Future changes

A server repository can replace IndexedDB without changing manifests or runtime. Add authenticated ownership and upload processing before multiuser deployment. Swap tracking adapters to evaluate the MIT 8th Wall engine; never silently include its proprietary SLAM binary. Draco/KTX2 decoders are local; representative compressed-asset tests and progressive LOD remain future work. Static hosting origin root is assumed; subpath hosts need Next basePath and rewritten public asset paths.
