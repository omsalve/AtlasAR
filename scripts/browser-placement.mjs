/** XR API rejection wiring only: no synthetic hit poses or claimed spatial tracking. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { chromium, expect as playwrightExpect } from "@playwright/test";

const expect = playwrightExpect.configure({ timeout: 20000 });
const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = join(root, ".artifacts");
const targetPath = join(root, "public", "assets", "target.png");
const base = (process.env.TEST_URL || "http://localhost:3001").replace(/\/$/, "");
const checks = [];
const errors = [];
const startedAt = new Date().toISOString();
let requestEvidence;
let failure;

await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
});
const context = await browser.newContext({ viewport: { width: 900, height: 900 }, reducedMotion: "reduce" });
await context.addInitScript(() => {
  globalThis.__placementCameraRequests = 0;
  globalThis.__placementStreams = [];
  globalThis.__placementXRSupportChecks = [];
  globalThis.__placementXRRequests = [];
  if (navigator.mediaDevices?.getUserMedia) {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (...args) => {
      globalThis.__placementCameraRequests += 1;
      return original(...args).then((stream) => { globalThis.__placementStreams.push(stream); return stream; });
    };
  }
  // Only advertise capability and reject the request. Never create an XR session,
  // frame, hit-test result, transform or pose; this cannot prove spatial tracking.
  Object.defineProperty(navigator, "xr", { configurable: true, value: {
    isSessionSupported: async (mode) => {
      globalThis.__placementXRSupportChecks.push(mode);
      return mode === "immersive-ar";
    },
    requestSession: (mode, options) => {
      const overlay = options?.domOverlay?.root;
      globalThis.__placementXRRequests.push({
        mode,
        requiredFeatures: [...(options?.requiredFeatures ?? [])],
        optionalFeatures: [...(options?.optionalFeatures ?? [])],
        overlayIsElement: overlay instanceof HTMLElement,
        overlayIsConnected: !!overlay?.isConnected,
        overlayIsUiRoot: !!overlay?.matches?.(".fp-overlay"),
        overlayContainsCameraOrCanvas: !!overlay?.querySelector?.(".fp-camera-video, .fp-render-canvas"),
        userActivationActive: navigator.userActivation?.isActive ?? null,
        cameraStatesAtRequest: globalThis.__placementStreams.flatMap((stream) => stream.getTracks().map((track) => track.readyState)),
      });
      return Promise.reject(new DOMException("Injected XR permission refusal for fallback test", "NotAllowedError"));
    },
  } });
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
page.on("pageerror", (error) => errors.push(error.message));
const placement = page.locator(".free-placement");

async function check(name, action) {
  const started = Date.now();
  try {
    await action();
    checks.push({ name, status: "passed", durationMs: Date.now() - started });
    console.log(`PASS ${name}`);
  } catch (error) {
    checks.push({ name, status: "failed", durationMs: Date.now() - started, error: error.message });
    throw error;
  }
}

async function screenshot(filename) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: join(artifacts, filename), fullPage: true, animations: "disabled" });
}

try {
  await page.goto(`${base}/experience/`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".experience-info > h1")).toHaveText("The Courtyard");
  await expect(page.getByRole("button", { name: "Explore Main entrance", exact: true })).toBeVisible({ timeout: 40000 });

  await check("Actual photo recognition gates a live manual-camera placement session", async () => {
    await page.getByRole("button", { name: "View in your space", exact: true }).click();
    await expect(page.getByRole("button", { name: "Use a photo target", exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => globalThis.__placementCameraRequests), 0);
    await page.getByLabel("Photo for target recognition", { exact: true }).setInputFiles(targetPath);
    await expect(page.locator('.photo-verified-placement[data-activation="photo-target"]')).toBeVisible({ timeout: 60000 });
    await expect(placement).toHaveAttribute("data-mode", "manual", { timeout: 30000 });
    await expect(placement.locator(".fp-camera-video")).toBeVisible();
    await expect.poll(() => placement.locator(".fp-camera-video").evaluate((video) => video.readyState >= 2 && video.srcObject?.getTracks().some((track) => track.readyState === "live"))).toBe(true);
    assert.equal(await page.evaluate(() => globalThis.__placementCameraRequests), 1);
    assert.deepEqual(await page.evaluate(() => globalThis.__placementXRRequests), []);
    await expect(placement.getByRole("button", { name: "Place on a surface", exact: true })).toBeVisible();
    await expect(placement).toContainText("Screen-relative placement");
  });

  await check("Surface button requests immersive AR with hit-test and a connected UI-only DOM overlay", async () => {
    const oldTracks = await placement.locator(".fp-camera-video").evaluateHandle((video) => video.srcObject.getTracks());
    await placement.getByRole("button", { name: "Place on a surface", exact: true }).click();
    await expect.poll(() => page.evaluate(() => globalThis.__placementXRRequests.length)).toBe(1);
    [requestEvidence] = await page.evaluate(() => globalThis.__placementXRRequests);
    assert.equal(requestEvidence.mode, "immersive-ar");
    assert.ok(requestEvidence.requiredFeatures.includes("hit-test"));
    assert.ok(requestEvidence.requiredFeatures.includes("dom-overlay"));
    assert.equal(requestEvidence.overlayIsElement, true);
    assert.equal(requestEvidence.overlayIsConnected, true);
    assert.equal(requestEvidence.overlayIsUiRoot, true);
    assert.equal(requestEvidence.overlayContainsCameraOrCanvas, false);
    assert.equal(requestEvidence.userActivationActive, true, "requestSession must execute in the trusted click activation");
    assert.ok(requestEvidence.cameraStatesAtRequest.length > 0);
    assert.ok(requestEvidence.cameraStatesAtRequest.every((state) => state === "ended"), "Manual camera must stop before requesting native AR");
    await expect.poll(() => oldTracks.evaluate((tracks) => tracks.every((track) => track.readyState === "ended"))).toBe(true);
    await oldTracks.dispose();
  });

  await check("Rejected XR request restores a fresh live manual preview with a visible explanation", async () => {
    await expect(placement).toHaveAttribute("data-mode", "manual", { timeout: 30000 });
    await expect(placement.locator(".fp-status")).toContainText("Manual camera preview");
    await expect(placement.locator(".fp-message")).toContainText("Surface placement is unavailable");
    await expect(placement.locator(".fp-message")).toContainText("Injected XR permission refusal");
    await expect(placement.locator(".fp-camera-video")).toBeVisible();
    await expect.poll(() => page.evaluate(() => globalThis.__placementCameraRequests)).toBe(2);
    const streamStates = await page.evaluate(() => globalThis.__placementStreams.map((stream) => stream.getTracks().map((track) => track.readyState)));
    assert.equal(streamStates.length, 2);
    assert.ok(streamStates[0].every((state) => state === "ended"));
    assert.ok(streamStates[1].some((state) => state === "live"));
    assert.equal(await page.evaluate(() => globalThis.__placementXRRequests.length), 1, "Fallback must not silently request XR again");
    await expect(page.locator('.free-placement[data-mode="xr-search"], .free-placement[data-mode="xr-placed"]')).toHaveCount(0);
    await screenshot("placement-xr-rejected-manual-restored.png");
  });

  await check("Scan physical target releases manual camera and returns to an idle target-tracking entry", async () => {
    const tracks = await placement.locator(".fp-camera-video").evaluateHandle((video) => video.srcObject.getTracks());
    await placement.getByRole("button", { name: "Scan physical target", exact: true }).click();
    await expect(placement).toHaveCount(0);
    await expect(page.locator(".photo-verified-placement")).toHaveCount(0);
    await expect(page.locator(".ar-view")).toHaveClass(/ar-state-idle/);
    await expect(page.locator(".ar-intro").getByRole("button", { name: "Start camera AR", exact: true })).toBeVisible();
    await expect(page.getByLabel("Photo for target recognition", { exact: true })).toHaveCount(1);
    await expect(page.locator(".fp-camera-video, .fp-render-canvas, .ar-photo-source, .ar-status")).toHaveCount(0);
    await expect.poll(() => tracks.evaluate((items) => items.every((track) => track.readyState === "ended"))).toBe(true);
    await tracks.dispose();
    assert.equal(await page.evaluate(() => globalThis.__placementCameraRequests), 2, "Returning to scanning UI must wait for an explicit camera action");
    await screenshot("placement-returned-to-physical-target-entry.png");
    await page.locator(".ar-view").getByRole("button", { name: "Back to 3D", exact: true }).click();
    await expect(page.locator(".ar-view")).toHaveCount(0);
  });

  assert.deepEqual(errors, [], "XR refusal/fallback wiring must not create uncaught page errors");
} catch (error) {
  failure = error;
  console.error(error);
  await screenshot("browser-placement-failure.png").catch(() => {});
} finally {
  await writeFile(join(artifacts, "browser-placement-results.json"), JSON.stringify({
    startedAt, completedAt: new Date().toISOString(), base, checks, errors, requestEvidence,
    xrApiInjected: true, actualSpatialTrackingTested: false, physicalDeviceTested: false,
    method: "Actual MindAR photo matching and native fake-device camera streams. Only navigator.xr capability/requestSession are injected; requestSession always rejects NotAllowedError. Verifies trusted-click arguments, manual-camera release, failure feedback, stream recovery and return to physical-target entry. No XR session, hit-test result or pose is fabricated.",
    passed: !failure, ...(failure ? { failure: failure.message } : {}),
  }, null, 2));
  await browser.close();
}
if (failure) process.exitCode = 1;
