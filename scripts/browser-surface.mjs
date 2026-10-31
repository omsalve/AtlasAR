/** Synthetic WebXR policy integration only. This does not measure real surface detection or phone tracking. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { chromium, expect as playwrightExpect } from "@playwright/test";

const expect = playwrightExpect.configure({ timeout: 20000 });
const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = join(root, ".artifacts");
const base = (process.env.TEST_URL || "http://localhost:3001").replace(/\/$/, "");
const checks = [], errors = [];
const startedAt = new Date().toISOString();
let failure;
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
});
const context = await browser.newContext({ viewport: { width: 900, height: 900 }, reducedMotion: "reduce" });
await context.addInitScript(() => {
  const state = {
    hits: [], viewerLost: false, viewerEmulated: false, anchorVisible: true, rejectAnchors: false, deferAnchors: false, pendingAnchors: [],
    anchorCreates: 0, anchorDeletes: 0, anchorPoseReads: 0, sourceCancels: 0, sessionEnds: 0,
    time: 0, frameActive: false, requests: [], sources: [], streams: [], sessions: [],
  };
  const transform = ({ x = 0, y = 0, z = 0, tilt = 0, invalid = false } = {}) => {
    const radians = tilt * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
    const matrix = new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, invalid ? NaN : x, y, z, 1]);
    return { matrix, position: { x, y, z, w: 1 }, orientation: { x: 0, y: 0, z: Math.sin(radians / 2), w: Math.cos(radians / 2) } };
  };
  const projection = new Float32Array([1.732, 0, 0, 0, 0, 1.732, 0, 0, 0, 0, -1.00004, -1, 0, 0, -.0200004, 0]);
  const originalCamera = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = (...args) => originalCamera(...args).then(stream => { state.streams.push(stream); return stream; });
  for (const type of [globalThis.WebGLRenderingContext, globalThis.WebGL2RenderingContext]) {
    if (type) Object.defineProperty(type.prototype, "makeXRCompatible", { configurable: true, value: async () => {} });
  }
  // The real renderer draws to its ordinary WebGL framebuffer. These deterministic
  // session/frame objects exercise application policy, not a native AR runtime.
  globalThis.XRWebGLLayer = class {
    constructor(_session, gl) {
      this.framebuffer = null; this.framebufferWidth = gl.drawingBufferWidth; this.framebufferHeight = gl.drawingBufferHeight;
    }
    getViewport() { return { x: 0, y: 0, width: this.framebufferWidth, height: this.framebufferHeight }; }
    static getNativeFramebufferScaleFactor() { return 1; }
  };
  class ReferenceSpace extends EventTarget {
    constructor(type) { super(); this.type = type; }
    getOffsetReferenceSpace() { return this; }
  }
  class Session extends EventTarget {
    constructor() {
      super(); this.renderState = {}; this.inputSources = []; this.visibilityState = "visible";
      this.environmentBlendMode = "alpha-blend"; this.enabledFeatures = ["hit-test", "dom-overlay", "anchors"];
      this.callbacks = new Map(); this.nextId = 1; this.spaces = new Map(); this.anchors = new Set(); this.ended = false;
    }
    async requestReferenceSpace(type) {
      if (!this.spaces.has(type)) this.spaces.set(type, new ReferenceSpace(type));
      return this.spaces.get(type);
    }
    updateRenderState(next) { Object.assign(this.renderState, next); }
    requestAnimationFrame(callback) { const id = this.nextId++; if (!this.ended) this.callbacks.set(id, callback); return id; }
    cancelAnimationFrame(id) { this.callbacks.delete(id); }
    async requestHitTestSource(options) {
      state.sources.push({ space: options.space.type, entityTypes: options.entityTypes });
      return { cancel() { state.sourceCancels += 1; } };
    }
    async end() {
      if (this.ended) return;
      this.ended = true; state.sessionEnds += 1; this.dispatchEvent(new Event("end")); this.callbacks.clear();
    }
    createAnchor(hit) {
      assertActive(); state.anchorCreates += 1;
      if (state.rejectAnchors) return Promise.reject(new DOMException("Synthetic anchor refusal", "NotSupportedError"));
      const anchor = {
        anchorSpace: { transform: transform(hit) }, deleted: false,
        delete: () => { if (!anchor.deleted) { anchor.deleted = true; this.anchors.delete(anchor); state.anchorDeletes += 1; } },
      };
      this.anchors.add(anchor);
      return state.deferAnchors ? new Promise(resolve => { state.pendingAnchors.push(() => resolve(anchor)); }) : Promise.resolve(anchor);
    }
    frame() {
      return {
        session: this, predictedDisplayTime: state.time,
        getViewerPose: () => state.viewerLost ? null : {
          emulatedPosition: state.viewerEmulated,
          transform: transform({ y: 1.6 }),
          views: [{ eye: "none", projectionMatrix: projection, transform: transform({ y: 1.6 }) }],
        },
        getHitTestResults: () => state.hits.map(hit => ({
          getPose: () => ({ transform: transform(hit), emulatedPosition: !!hit.emulated }),
          createAnchor: () => this.createAnchor(hit),
        })),
        getPose: (space) => {
          state.anchorPoseReads += 1;
          return state.anchorVisible ? { transform: space.transform, emulatedPosition: false } : null;
        },
        trackedAnchors: state.anchorVisible ? new Set(this.anchors) : new Set(),
      };
    }
  }
  function assertActive() { if (!state.frameActive) throw new DOMException("Anchor creation must use an active XR frame", "InvalidStateError"); }
  Object.defineProperty(navigator, "xr", { configurable: true, value: {
    isSessionSupported: async mode => mode === "immersive-ar",
    requestSession: async (mode, options) => {
      state.requests.push({ mode, requiredFeatures: options.requiredFeatures, optionalFeatures: options.optionalFeatures, cameraStates: state.streams.flatMap(stream => stream.getTracks().map(track => track.readyState)) });
      const session = new Session(); state.sessions.push(session); return session;
    },
  } });
  globalThis.__surfaceTest = {
    state,
    set: (values) => Object.assign(state, values),
    async pump(count = 1, milliseconds = 100) {
      const session = state.sessions.at(-1);
      for (let i = 0; i < count; i += 1) {
        if (!session || session.ended) throw new Error("No active synthetic XR session");
        state.time += milliseconds;
        const callbacks = [...session.callbacks.values()]; session.callbacks.clear();
        if (!callbacks.length) throw new Error("XR renderer did not register a frame callback");
        const frame = session.frame(); state.frameActive = true;
        try { callbacks.forEach(callback => callback(state.time, frame)); }
        finally { state.frameActive = false; }
        await Promise.resolve(); await Promise.resolve();
      }
    },
    select() {
      const session = state.sessions.at(-1), event = new Event("select");
      event.frame = session.frame(); event.inputSource = { targetRayMode: "screen" }; session.dispatchEvent(event);
    },
    reset() { state.sessions.at(-1).spaces.get("local").dispatchEvent(new Event("reset")); },
    visibility(value) { const session = state.sessions.at(-1); session.visibilityState = value; session.dispatchEvent(new Event("visibilitychange")); },
    async resolveAnchors() { state.pendingAnchors.splice(0).forEach(resolve => resolve()); await Promise.resolve(); await Promise.resolve(); },
    evidence: () => ({
      requests: state.requests, sources: state.sources, anchorCreates: state.anchorCreates, anchorDeletes: state.anchorDeletes,
      anchorPoseReads: state.anchorPoseReads, sourceCancels: state.sourceCancels, sessionEnds: state.sessionEnds,
      remainingFrameCallbacks: state.sessions.reduce((sum, session) => sum + session.callbacks.size, 0),
      pendingAnchors: state.pendingAnchors.length,
      cameraStates: state.streams.map(stream => stream.getTracks().map(track => track.readyState)),
    }),
  };
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
page.on("pageerror", error => errors.push(error.message));
const placement = page.locator(".free-placement");
const autoPlace = placement.getByRole("checkbox", { name: /auto-place/i });
const placeButton = placement.getByRole("button", { name: "Place building", exact: true });
const hit = { x: 0, y: 0, z: -1.5 };
async function check(name, action) {
  const started = Date.now();
  try { await action(); checks.push({ name, status: "passed", durationMs: Date.now() - started }); console.log(`PASS ${name}`); }
  catch (error) { checks.push({ name, status: "failed", durationMs: Date.now() - started, error: error.message }); throw error; }
}
async function set(values) { await page.evaluate(values => globalThis.__surfaceTest.set(values), values); }
async function pump(count = 1, milliseconds = 100) { await page.evaluate(({ count, milliseconds }) => globalThis.__surfaceTest.pump(count, milliseconds), { count, milliseconds }); }
async function evidence() { return page.evaluate(() => globalThis.__surfaceTest.evidence()); }
async function search() { await expect(placement).toHaveAttribute("data-mode", "xr-search"); }
async function placed() { await expect(placement).toHaveAttribute("data-mode", "xr-placed"); }
async function captureLayouts(phase) {
  for (const size of [{ width: 390, height: 844, name: "portrait" }, { width: 844, height: 390, name: "landscape" }]) {
    await page.setViewportSize({ width: size.width, height: size.height });
    if (phase === "search") {
      await expect(placement.locator(".fp-scan-guide")).toBeVisible();
      const centerObscured = await page.evaluate(() => !!document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest("[data-placement-ui]"));
      assert.equal(centerObscured, false, `${size.name}: scanning aim point must remain clear of controls`);
      for (const label of ["Place building", "Use manual preview"]) {
        const bounds = await placement.getByRole("button", { name: label, exact: true }).boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= size.width && bounds.y + bounds.height <= size.height, `${size.name}: ${label} must fit fully in the viewport without scrolling`);
        assert.ok(bounds.height >= 44, `${size.name}: ${label} must retain its 44px touch target`);
      }
    }
    await page.screenshot({ path: join(artifacts, `surface-synthetic-${phase}-${size.name}.png`), fullPage: false, animations: "disabled" });
  }
  await page.setViewportSize({ width: 900, height: 900 });
}

try {
  await page.goto(`${base}/experience/`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Explore Main entrance", exact: true })).toBeVisible({ timeout: 40000 });
  await page.getByRole("button", { name: "View in your space", exact: true }).click();
  await page.getByLabel("Photo for target recognition", { exact: true }).setInputFiles(join(root, "public/assets/target.png"));
  await expect(placement).toHaveAttribute("data-mode", "manual", { timeout: 60000 });

  await check("Trusted surface entry requests optional anchors and releases the ordinary camera", async () => {
    await placement.getByRole("button", { name: "Place on a surface", exact: true }).click();
    await search(); await pump();
    const { requests, sources } = await evidence();
    assert.equal(requests.length, 1); assert.equal(requests[0].mode, "immersive-ar");
    assert.ok(requests[0].requiredFeatures.includes("hit-test")); assert.ok(requests[0].requiredFeatures.includes("dom-overlay"));
    assert.ok(requests[0].optionalFeatures?.includes("anchors"), "Anchor support should be requested optionally"); assert.ok(!requests[0].requiredFeatures.includes("anchors"));
    assert.ok(requests[0].cameraStates.length > 0); assert.ok(requests[0].cameraStates.every(value => value === "ended"));
    assert.equal(sources[0].space, "viewer"); assert.deepEqual(sources[0].entityTypes, ["plane"]);
    await expect(autoPlace).toBeChecked();
  });

  await check("Portrait and short-landscape search controls leave the scan aim point clear", async () => {
    await captureLayouts("search");
  });

  await check("Absent, invalid, vertical, distant and emulated poses cannot auto-place a building", async () => {
    for (const invalid of [[], [{ ...hit, invalid: true }], [{ ...hit, tilt: 90 }], [{ ...hit, z: -8 }], [{ ...hit, x: 0, y: 1.6, z: -.1 }], [{ ...hit, emulated: true }]]) {
      await set({ hits: invalid }); await pump(15); await search(); await expect(placeButton).toBeDisabled();
    }
    await set({ hits: [hit], viewerEmulated: true }); await pump(15); await search(); await expect(placeButton).toBeDisabled();
    await set({ viewerEmulated: false });
    assert.equal((await evidence()).anchorCreates, 0);
  });

  await check("Jumps between planes reset stability instead of accepting a single good hit", async () => {
    for (let i = 0; i < 20; i += 1) { await set({ hits: [{ ...hit, x: i % 2 ? .5 : 0 }] }); await pump(); }
    await search(); await expect(placeButton).toBeDisabled(); assert.equal((await evidence()).anchorCreates, 0);
  });

  await check("A sustained stable horizontal surface auto-places once and creates an anchor in the active frame", async () => {
    await set({ hits: [hit] }); await pump(3); await search(); await expect(placeButton).toBeDisabled();
    await pump(10); await placed(); assert.equal((await evidence()).anchorCreates, 1);
    await pump(10); await placed(); assert.equal((await evidence()).anchorCreates, 1, "Auto-place must not create an anchor every frame");
    assert.ok((await evidence()).anchorPoseReads > 0, "Placed content must query the tracked anchor pose");
    await captureLayouts("placed");
  });

  await check("Viewer and anchor tracking loss display recovery guidance and recover without a second placement", async () => {
    await set({ viewerLost: true }); await pump(2); await expect(placement.locator(".fp-message")).toContainText(/tracking|paused|recover/i); await expect(placement).toHaveAttribute("data-tracking", "lost");
    await set({ viewerLost: false }); await pump(2); await placed(); await expect(placement).toHaveAttribute("data-tracking", "tracking");
    await set({ anchorVisible: false }); await pump(2); await expect(placement.locator(".fp-message")).toContainText(/tracking|paused|recover|anchor/i); await expect(placement).toHaveAttribute("data-tracking", "lost");
    await set({ anchorVisible: true }); await pump(2); await placed(); await expect(placement).toHaveAttribute("data-tracking", "tracking");
    await page.evaluate(() => globalThis.__surfaceTest.visibility("hidden")); await pump(); await expect(placement).toHaveAttribute("data-tracking", "lost");
    await page.evaluate(() => globalThis.__surfaceTest.visibility("visible")); await pump(); await placed(); await expect(placement).toHaveAttribute("data-tracking", "tracking");
    assert.equal((await evidence()).anchorCreates, 1);
  });

  await check("Reposition deletes the prior anchor and manual confirmation waits for fresh stability", async () => {
    await placement.getByRole("button", { name: "Reposition", exact: true }).click(); await search();
    assert.equal((await evidence()).anchorDeletes, 1);
    await autoPlace.uncheck(); await set({ hits: [] }); await pump(); await expect(placeButton).toBeDisabled();
    await set({ hits: [hit] }); await pump(12); await search(); await expect(placeButton).toBeEnabled();
    assert.equal((await evidence()).anchorCreates, 1, "Manual confirmation mode must not auto-place");
  });

  await check("A select after a hit disappears cannot place at the stale reticle", async () => {
    await set({ hits: [] }); await pump(); await expect(placeButton).toBeDisabled();
    await page.evaluate(() => globalThis.__surfaceTest.select()); await pump(); await search();
    assert.equal((await evidence()).anchorCreates, 1);
    await set({ hits: [hit] }); await pump(12); await expect(placeButton).toBeEnabled();
    await placeButton.click(); await pump(); await placed(); assert.equal((await evidence()).anchorCreates, 2);
  });

  await check("An anchored reference-space reset recovers from its tracked anchor pose", async () => {
    const before = await evidence();
    await set({ hits: [] }); await page.evaluate(() => globalThis.__surfaceTest.reset()); await pump(2); await placed();
    await expect(placement).toHaveAttribute("data-tracking", "tracking");
    const after = await evidence(); assert.equal(after.anchorCreates, before.anchorCreates); assert.equal(after.anchorDeletes, before.anchorDeletes);
    assert.ok(after.anchorPoseReads > before.anchorPoseReads);
  });

  await check("An optional anchor refusal preserves usable world-space placement", async () => {
    await placement.getByRole("button", { name: "Reposition", exact: true }).click(); await search(); assert.equal((await evidence()).anchorDeletes, 2);
    await set({ hits: [hit], rejectAnchors: true }); await pump(12); await expect(placeButton).toBeEnabled();
    await placeButton.click(); await pump(2); await placed(); assert.equal((await evidence()).anchorCreates, 3);
  });

  await check("An unanchored reference-space reset clears placement and requires a newly stable surface", async () => {
    await set({ hits: [] }); await page.evaluate(() => globalThis.__surfaceTest.reset()); await pump(); await search();
    await expect(placeButton).toBeDisabled(); assert.equal((await evidence()).anchorDeletes, 2);
  });

  await check("An anchor resolving after Reposition is deleted rather than attached to the new placement", async () => {
    await set({ hits: [hit], rejectAnchors: false, deferAnchors: true }); await pump(12); await expect(placeButton).toBeEnabled();
    await placeButton.click(); await pump(); await placed(); assert.equal((await evidence()).pendingAnchors, 1);
    await placement.getByRole("button", { name: "Reposition", exact: true }).click(); await search();
    await page.evaluate(() => globalThis.__surfaceTest.resolveAnchors());
    assert.equal((await evidence()).anchorDeletes, 3); assert.equal((await evidence()).pendingAnchors, 0);
    await pump(12); await expect(placeButton).toBeEnabled(); await placeButton.click(); await pump(); await placed();
    assert.equal((await evidence()).pendingAnchors, 1);
  });

  await check("Exit ends the synthetic session, cancels hit tests and releases frame/camera resources", async () => {
    await placement.getByRole("button", { name: "Back to 3D", exact: true }).click(); await expect(placement).toHaveCount(0);
    await page.evaluate(() => globalThis.__surfaceTest.resolveAnchors());
    const result = await evidence(); assert.equal(result.sessionEnds, 1); assert.equal(result.sourceCancels, 1); assert.equal(result.remainingFrameCallbacks, 0);
    assert.equal(result.anchorDeletes, 4, "An anchor resolving after exit must also be deleted"); assert.equal(result.pendingAnchors, 0);
    assert.ok(result.cameraStates.flat().every(value => value === "ended"));
    await expect(page.locator(".fp-camera-video, .fp-render-canvas")).toHaveCount(0);
  });
  assert.deepEqual(errors, [], "Synthetic surface integration must not create uncaught page errors");
} catch (error) {
  failure = error; console.error(error);
  await page.screenshot({ path: join(artifacts, "browser-surface-failure.png"), fullPage: true }).catch(() => {});
} finally {
  await writeFile(join(artifacts, "browser-surface-results.json"), JSON.stringify({
    startedAt, completedAt: new Date().toISOString(), base, checks, errors, evidence: await evidence().catch(() => null),
    syntheticXRSession: true, actualSpatialTrackingTested: false, physicalDeviceTested: false,
    method: "Actual application, model, MindAR photo matching and WebGL rendering. Synthetic XR session, timestamps, viewer/hit/anchor poses test placement policy, invalidation and lifecycle only. This cannot establish device compatibility, camera optics, real plane detection, anchor accuracy or physical tracking quality.",
    passed: !failure, ...(failure ? { failure: failure.message } : {}),
  }, null, 2));
  await browser.close();
}
if (failure) process.exitCode = 1;
