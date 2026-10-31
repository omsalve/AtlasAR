# Phone usage and deployment

Verified against official documentation on 31 October 2026. The application has been built and tested locally as a static production export; no Vercel account, purchase or deployment was performed.

## Two target flows

| Input | Result | Placement behavior |
|---|---|---|
| **Use a photo target** | MindAR verifies the selected photo against the configured target, then automatically opens the live camera | Tap/drag to position in manual mode; supported browsers offer genuine WebXR surface placement |
| **Start camera AR** | The live camera searches for the configured physical image | Building appears on the detected image and follows it; loss hides the building until the image returns |

The photo is only an activation check. Its pose is discarded, and the selected photo is never used as the placement background. A nonmatching or invalid photo does not open the camera. Camera permission is still required after a successful check. The selected test photo is not uploaded or saved as a new project target.

To configure a different image for either flow, open the project editor, select **Assets -> Upload & compile a target**, choose your image, compile it, save and publish. Both input flows use that matching image/`.mind` pair. An arbitrary photo does not automatically become a target merely because it was selected for scanning.

## Free placement support

After photo verification, manual mode provides a live camera with tap/drag positioning, rotation, pinch/button scaling, floor controls and POIs. It is explicitly **screen-relative**: it does not detect surfaces or keep the building fixed in the room when the phone moves.

Where `navigator.xr.isSessionSupported('immersive-ar')` succeeds, **Place on a surface** requests an actual WebXR session with hit testing and DOM overlays. Aim at a floor/tabletop, wait for the reticle, then select **Place building**. **Reposition** lets you choose another surface location. The native session owns its camera and tracked view. The ordinary camera stream is stopped before requesting it. A new user tap is required to start native XR; the browser does not allow silently starting an immersive session after asynchronous photo matching.

WebXR is not universal across phones/browsers. Unsupported or refused sessions retain/recover the honestly labeled manual preview. Successful native surface tracking, real camera optics and phone performance still require physical-device testing. Browser tests verify the native request's parameters and failure recovery; they do not fabricate a successful hit-test session.

Sources: [WebXR compatibility](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API), [session support check](https://developer.mozilla.org/en-US/docs/Web/API/XRSystem/isSessionSupported), [hit testing](https://developer.mozilla.org/en-US/docs/Web/API/XRSession/requestHitTestSource), [DOM overlays](https://immersive-web.github.io/dom-overlays/).

## Vercel

The committed `vercel.json` selects Next.js, `npm ci` and `npm run build`. Node 24.x is specified in `package.json`. Import the repository with this project as its root directory. In **Settings -> Build and Deployment**, select the **Next.js** framework preset and leave the **Output Directory override disabled**. If an existing project has that override set to `out`, turn it off before redeploying.

Keep `output: "export"` in `next.config.ts`. Vercel's Next.js adapter first reads build manifests from `.next/`, then detects the static export and serves `out/` automatically. Setting Vercel's output directory to `out` makes it search for `out/routes-manifest.json` and fail with `NEXT_NO_ROUTES_MANIFEST`, even when the app build succeeds. Other plain static hosts can serve `out/` directly.

After deploying the corrected commit, use the resulting HTTPS production URL on the phone. The app needs no database, API keys, paid AR SDK or backend functions. Bundled sample assets and local tracking/decoder files ship with the build.

Vercel provides automatic HTTPS, satisfying the transport requirement for camera access and WebXR. HTTPS alone cannot add a browser's missing camera/XR capability or grant permission. Local production builds and browser checks pass; an actual Vercel deployment and physical phone session were not tested here.

Vercel Hobby is restricted to **personal, non-commercial use**. A commercial real-estate deployment cannot assume Hobby as its zero-cost production plan. No upgrade or service purchase has been made. Another static HTTPS host can serve the same `out/` after checking its current terms/limits.

Primary sources: [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs), [build/output configuration](https://vercel.com/docs/builds/configure-a-build), [Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), [automatic SSL](https://vercel.com/docs/domains/working-with-ssl), [Hobby restrictions](https://vercel.com/docs/plans/hobby).

## Projects and devices

Hosting does not synchronize IndexedDB. Localhost, a Vercel domain, and another phone/profile have separate storage. Use `/experience/` for the bundled sample, author on the phone, import a project ZIP on the phone, or copy the exported `projects/` directory into `public/` and redeploy it for every visitor. Generate QR URLs using the deployed HTTPS origin. A localhost QR points at the scanning phone itself.

For live physical-target testing, print the configured image or display it on a second device. For photo activation, save/select a photo containing that target. JPEG/PNG/WebP are supported, and HEIC depends on native browser decoding; export a JPEG if necessary. Verify both flows on physical iOS Safari and Android Chrome before a production rollout.
