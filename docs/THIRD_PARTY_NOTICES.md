# Third-party and asset notices

Original Atlas AR application code, procedural building/interior models, previews and target artwork are licensed under the root MIT license. They were generated for this project and do not contain purchased or unlicensed model assets. The brochure target embeds the original building preview. GLB extras and the generator record provenance.

Retain applicable upstream notices when distributing. Installed npm packages retain their licenses in `node_modules`; publicly served runtime dependencies carry their notices in `public/vendor`.

| Dependency | License | Source |
|---|---|---|
| MindAR 1.2.5 | MIT | [actual license](https://github.com/hiukim/mind-ar-js/blob/master/LICENSE); copied to public/vendor/mindar/LICENSE |
| TensorFlow.js (bundled in MindAR) | Apache 2.0 | [license](https://github.com/tensorflow/tfjs/blob/master/LICENSE) |
| Three.js 0.160.0 | MIT | [license](https://github.com/mrdoob/three.js/blob/r160/LICENSE); copied to public/vendor/THREE-LICENSE.txt |
| Draco decoder | Apache 2.0 | [license](https://github.com/google/draco/blob/main/LICENSE); preserve notices in decoder distribution |
| Basis Universal transcoder | Apache 2.0 | [license](https://github.com/BinomialLLC/basis_universal/blob/master/LICENSE); copied distribution includes README notices |
| Meshoptimizer | MIT | [license](https://github.com/zeux/meshoptimizer/blob/master/LICENSE.md); decoder bundled through Three.js |
| Next.js, React | MIT | [Next](https://github.com/vercel/next.js/blob/canary/license.md), [React](https://github.com/facebook/react/blob/main/LICENSE) |
| QRCode | MIT | [license](https://github.com/soldair/node-qrcode/blob/master/license) |
| fflate | MIT | [license](https://github.com/101arrowz/fflate/blob/master/LICENSE) |
| Lucide | ISC | [license](https://github.com/lucide-icons/lucide/blob/main/LICENSE) |
| Playwright (development tests) | Apache 2.0 | [license](https://github.com/microsoft/playwright/blob/main/LICENSE) |

MindAR vendoring verifies the npm tarball integrity and records it in `public/vendor/mindar/PROVENANCE.json`. Two documented lifecycle patches return the existing processing-loop Promise and release actual detector/tracker tensor caches, InputLoader TensorInfo and its worker during disposal. Tracking algorithms are unchanged. The compiler document is isolated and disposable. No 8th Wall binary, licensed commercial SDK, telemetry service, or third-party asset API is included.

This inventory summarizes selected direct/runtime components. It does not relabel every npm transitive package with the parent package's license. Review the installed dependency license inventory before a wider redistribution.
