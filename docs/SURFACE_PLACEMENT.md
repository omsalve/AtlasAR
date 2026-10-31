# Surface placement research and implementation

Researched and implemented 31 October 2026. The browser's native AR runtime detects planes. This application validates and stabilizes its hit results; it does not implement SLAM or estimate a physical surface from an ordinary camera stream.

## Findings

The previous surface flow accepted the first horizontal-looking hit immediately, without a stability window or distance check. Its normal threshold permitted slopes of about 41 degrees. It copied a local-space pose when the user tapped, without requesting a native anchor. It did not automatically place the building. Together these could produce flickering readiness, premature placement and weaker recovery as the native environment estimate changed.

[Google's placement guidance](https://developers.google.com/ar/design/content/content-placement) recommends guiding people to scan appropriate surroundings and showing where content will be placed. The [WebXR hit-test specification](https://immersive-web.github.io/hit-test/#xrhittestresult-interface) defines a pose whose Y axis follows the hit surface normal. [ARCore's anchor guidance](https://developers.google.com/ar/develop/anchors) explains why objects should use tracked anchors as the system refines its understanding of the world.

The [WebXR anchors specification](https://immersive-web.github.io/anchors/#dom-xrhittestresult-createanchor) requires creating a hit-based anchor while the hit's frame is active. A DOM button therefore queues placement intent; the next render frame validates a fresh hit and invokes anchor creation synchronously. Anchors are optional so their absence/refusal does not prevent native world-space placement.

## Implemented policy

- Request native plane hit testing, DOM overlays and optional anchors. Keep the ordinary camera stream stopped for the entire XR session.
- Accept finite, non-emulated, upward-facing surface poses within 20 degrees of horizontal and 0.25–5 meters from the viewer. Reject walls, ceilings and out-of-range hits.
- Require at least 600 ms and eight observations with no tracking gap over 200 ms. Average nearby positions, reject deviations over 2.5 cm, and restart acquisition after jumps, drift, missing hits or loss of positional tracking. Preserve enough observations to allow slower frame rates to finish acquisition.
- Keep continuity between overlapping plane results, show an amber acquiring ring and stability progress, then automatically place by default. A checkbox enables explicit confirmation. These are application heuristics, not a native confidence score or a guarantee that the whole building fits the physical plane.
- Place the normalized model upright with its base at the surface. Preserve the averaged placement offset relative to one native anchor and update that anchor's pose each frame. Delete the anchor on reposition, reset and exit; delete late anchor results after the owning placement/session expires.
- Hide the object when viewer or anchor tracking is unavailable. Recover an existing anchor rather than inventing a new pose. If an unanchored reference space resets, require a fresh scan. Guard asynchronous session startup against stale results from earlier attempts.
- Align the on-screen aiming guide with the center-view hit-test ray. Show scan/hold-still/recovery instructions, hide unrelated controls during acquisition and keep controls scrollable on short screens.

`lib/surface-placement.ts` contains the deterministic acquisition policy. `components/free-placement.tsx` owns session, anchor and camera lifecycle. No new SDK, paid service or server is involved. Physical image-target scanning continues to use its image anchor rather than surface placement.

## Device validation

Automated tests exercise the policy and lifecycle using explicitly synthetic XR poses. A physical phone is still required to measure actual detection, drift, scale, frame rate and recovery.

On the deployed HTTPS origin, verify the photo target, choose **Place on a surface**, then scan a matte, textured floor/table from roughly 0.5–2 m. Compare bright/dim lighting, plain/glossy surfaces and a moving phone. Check that automatic placement waits while moving, appears after holding steady, stays on the surface when walking around, hides during tracking loss, recovers, and scans again after reposition/reset. Repeat with automatic placement disabled and with anchors unavailable. Record phone, browser, OS and observed behavior.

An ordinary camera preview cannot perform native plane detection. If **Place on a surface** is absent, the browser did not advertise immersive AR support; use manual preview or the physical image target. HTTPS supplies the required secure context but cannot add missing browser/device tracking capabilities.
