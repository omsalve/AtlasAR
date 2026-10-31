# Atlas AR — technology research

Verified 31 October 2026. Primary documentation and actual license files were inspected before implementation. Browser/device performance statements below are engineering assessments, not hardware test results.

## Executive summary

A zero-service-cost image-target architecture is viable. Use MindAR 1.2.5 for natural-image tracking, Three.js 0.160.0 for rendering, the existing Next.js/React/TypeScript application, and IndexedDB for local authoring. Export static manifests/assets for cross-device publication. No subscription, authentication service, cloud database, API key, credit card, or paid SDK is necessary. Existing hardware, electricity, internet access, and eventual bandwidth are operating assumptions, not universally free resources.

8th Wall is now a legitimate MIT image-tracking alternative. It must not be dismissed using old proprietary-only information. Its new engine is prerelease, and its optional proprietary SLAM binary is a different product with restrictive terms. MindAR is selected for its simpler documented Three.js integration and established target compiler. Physical device tracking quality remains an acceptance gate.

## 8th Wall status and actual licenses

- [Official homepage](https://8thwall.org/) (8thwall.com redirects) and [migration FAQ](https://8thwall.org/docs/migration/faq): hosted authoring closed on 28 February 2026; existing hosted experiences are scheduled to remain until 28 February 2027. Current local tools do not require a subscription/account.
- [Official monorepo](https://github.com/8thwall/8thwall), [actual MIT LICENSE](https://raw.githubusercontent.com/8thwall/8thwall/main/LICENSE), [engine package manifest](https://raw.githubusercontent.com/8thwall/8thwall/main/packages/engine/package.json), and [open-source guide](https://8thwall.org/docs/open-source): the framework, image targets, face/sky effects, ECS, XR Extras, fallback UI, desktop and image-target CLI source are publicly released. MIT permits commercial use and modification with retained notices.
- [Engine README](https://raw.githubusercontent.com/8thwall/8thwall/main/packages/engine/README.md): `@8thwall/engine` 0.1.0 is explicitly prerelease. Its XrController supports image targets, not SLAM (even though a legacy chunk is named slam). npm dist artifacts can be copied and served locally. Default CDN examples are optional, not cloud requirements.
- [Separate binary license](https://raw.githubusercontent.com/8thwall/engine/main/LICENSE): the optional world-tracking engine is not open source. Original-form execution/distribution is licensed subject to restrictions including competitive products and paid services deriving substantial value from the engine. It excludes VPS/Maps/Hand Tracking. Do not include it in this platform. This is an engineering interpretation for dependency selection, not a substitute for legal review.
- [Image-target CLI](https://raw.githubusercontent.com/8thwall/8thwall/main/apps/image-target-cli/README.md) supports local target processing without paid training; [contributing instructions](https://github.com/8thwall/8thwall/blob/main/CONTRIBUTING.md) specify Bazelisk, Buildifier, Node and Python. Full engine source compilation on this Windows environment was not verified. Use packaged builds if evaluating it later.
- [Commit history](https://github.com/8thwall/8thwall/commits/main/) showed August 2026 fixes, including Windows setup and chunk paths. No maintenance SLA is implied. The homepage's desktop-source-coming-soon statement conflicts with newer repository contents; prefer repository evidence.

## Comparison

| Technology | Money/license/commercial use | Image tracking and mobile | Three.js, performance, development | Self-hosting / future SaaS |
|---|---|---|---|---|
| MindAR | $0, MIT, commercial with notices | Natural-image targets; camera/WebGL on compatible mobile browsers, no WebXR requirement | Direct renderer/scene/camera and anchors; feature compilation required; CPU/GPU/device dependent | Fully local dist + targets; simple adapter; individual-maintained project, no SLA |
| 8th Wall MIT engine | $0, MIT; prerelease 0.1.0 | Image targets, face/sky; SLAM excluded | Pipeline integration; more tools and mixed old/new docs; APIs may change | Local npm artifacts; legitimate future evaluation |
| 8th Wall binary | No initial fee under separate restricted license; not OSS | World tracking; excluded services remain unavailable | Proprietary binary | Reject for this potential competing/commercial authoring product |
| AR.js | $0; own MIT plus bundled artoolkit5-js LGPLv3/additional permission | NFT images, fiducial markers, location/GPS; NFT preprocessing | A-Frame/Three.js integrations; different tracking characteristics, more descriptor setup | Self-hostable; review dependency obligations |
| Three.js | $0, MIT | Rendering only; not a tracking engine | glTF, animation, OrbitControls, WebGL; cap pixel ratio and assets | Selected renderer; pin compatible version |
| WebXR | Browser standard, no SDK subscription | Device sessions; image/marker tracking is an unstable draft, not universal Safari/Android support | Useful future hit-test/world-placement capability | Not the sole MVP image tracker |
| OpenCV.js | $0, Apache 2.0 for >=4.5 | CV primitives, not a complete stable AR product | Would require feature matching, pose, camera calibration, stabilization | Reject custom tracker implementation effort |
| Encantar | GPL-3.0-or-later free edition or paid proprietary license | Web image tracking | Viable GPL application foundation | GPL permits commerce but imposes distribution obligations; reject purchased proprietary route |

Primary references: [MindAR repository](https://github.com/hiukim/mind-ar-js), [actual MIT](https://raw.githubusercontent.com/hiukim/mind-ar-js/master/LICENSE), [installation](https://hiukim.github.io/mind-ar-js-doc/installation/), [Three.js example](https://hiukim.github.io/mind-ar-js-doc/more-examples/threejs-image/), [compiler](https://hiukim.github.io/mind-ar-js-doc/tools/compile/), [tracking settings](https://hiukim.github.io/mind-ar-js-doc/quick-start/tracking-config/); [AR.js repository](https://github.com/AR-js-org/AR.js), [actual LICENSE](https://raw.githubusercontent.com/AR-js-org/AR.js/master/LICENSE), [NFT guide](https://ar-js-org.github.io/AR.js-Docs/image-tracking/), [releases](https://github.com/AR-js-org/AR.js/releases); [Three actual MIT](https://raw.githubusercontent.com/mrdoob/three.js/dev/LICENSE), [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html); [WebXR](https://immersiveweb.dev/), [unstable image-tracking draft](https://immersive-web.github.io/image-tracking/); [OpenCV license](https://opencv.org/license/); [Encantar manifest](https://github.com/alemart/encantar-js/blob/master/package.json), [download/license terms](https://encantar.dev/download/).

MindAR official examples pair 1.2.5 with Three r160. Its npm graph includes native canvas and TensorFlow dependencies. Vendor the official production browser distributions and MIT notice instead of installing native training dependencies. Keep all runtime scripts local. This is a deliberate compatibility pin, not a claim that r160 is the latest Three release.

## Asset pipeline

GLB is the preferred single-file exchange format. Support embedded glTF as well; reject external-buffer glTF uploads so files cannot silently disappear. Produce original procedural architecture and a separate furnished interior, exported to real GLB, avoiding third-party model rights. Preserve named floor nodes. Do not infer floors in arbitrary models.

[Blender](https://www.blender.org/about/license/) is GPL software, but generated artwork can be used commercially independently. [glTF Transform CLI](https://gltf-transform.dev/cli) supports pruning, deduplication, resizing, meshopt/Draco and KTX2. [Khronos Validator](https://github.khronos.org/glTF-Validator/) checks format and structure ([Apache 2.0 license](https://raw.githubusercontent.com/KhronosGroup/glTF-Validator/main/LICENSE)). [KTX2Loader](https://threejs.org/docs/pages/KTX2Loader.html) needs a transcoder and renderer capability detection. The implementation now ships local Draco and Basis/KTX2 decoder assets and their license notices, configures capability detection, and uses Meshopt from the pinned Three package. This establishes configured support, not a claim that every compressed asset/phone combination was tested; sample uncompressed GLB loading and mobile decoder performance are separate checks. Use separately loaded interiors, 1–2K textures, fewer materials/draw calls, and appropriate LODs. Compressed download size is not GPU memory usage.

## Hosting and persistence

| Option | Current verified constraints | Decision |
|---|---|---|
| Local / IndexedDB | Origin/profile-local, storage quota/eviction possible; exports needed | Selected; no account/card/backend |
| Cloudflare Pages Free | 500 builds/month, 20,000 files, 25 MiB/file; static requests free/unlimited; product page says no card | Optional static HTTPS host, not deployed here; recheck service terms before commercial operation |
| GitHub Pages | 1GB site, soft 100GB/month bandwidth; explicitly excludes online businesses/commercial SaaS | Documentation/noncommercial demos only |
| Vercel Hobby | Personal/noncommercial restriction | Reject for assumed commercial real estate hosting |
| Supabase Free | 2 active projects, 500MB DB, 1GB storage, 5GB egress +5GB cached; inactivity pause after one week | Unnecessary dependency; not selected |
| SQLite | Public domain, commercial use permitted | Future single-server option |
| PostgreSQL | Permissive PostgreSQL license | Future multiuser option; hosting resources still needed |
| Cloudflare R2 | Free allowance but subscription checkout and metered excess | Reject no-billing assumption |

Sources: [Cloudflare limits](https://developers.cloudflare.com/pages/platform/limits/), [pricing](https://developers.cloudflare.com/pages/functions/pricing/), [no-card statement](https://www.cloudflare.com/products/pages/); [GitHub restrictions](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits); [Vercel Hobby](https://vercel.com/docs/plans/hobby), [terms](https://vercel.com/legal/terms); [Supabase pricing](https://supabase.com/pricing), [billing](https://supabase.com/docs/guides/platform/billing-on-supabase), [self-hosting](https://supabase.com/docs/guides/self-hosting); [SQLite actual license](https://github.com/sqlite/sqlite/blob/master/LICENSE.md); [PostgreSQL license](https://www.postgresql.org/about/licence/); [IndexedDB standard](https://www.w3.org/TR/IndexedDB/), [storage standard](https://storage.spec.whatwg.org/); [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [checkout](https://developers.cloudflare.com/r2/get-started/).

Cloudflare blanket commercial permission was not independently established in this pass; absence of a Hobby-like clause is not a legal guarantee. Supabase card signup was not tested. No provider is promised permanently free. No provider signup or deployment is part of this local MVP.

## Recommended stack and unresolved risks

Next.js static export + React + TypeScript, Three.js r160, MindAR browser builds, IndexedDB repository/Blob storage, local QR SVG generation, Node's test runner and Playwright browser checks. No auth because there is no server/private shared workspace; a future multiuser service must add access control and upload isolation. No hosting deployment was performed.

Camera requires [secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts) and explicit permission. A phone's localhost is the phone, not the development computer. LAN HTTP suffices for 3D, ordinarily not camera. Local publication is not internet publication: browser-stored uploaded assets must be exported and hosted before a QR can share them.

Unresolved until device tests: lighting/print target quality, Safari/Android camera and memory behavior, true mobile FPS, target reacquisition and thermal performance. Browser emulation cannot establish these. No claim of 8th Wall quality parity or world tracking is made.
