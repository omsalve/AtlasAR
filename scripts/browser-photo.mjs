/** Actual MindAR photo verification, then live-camera placement. No physical-device claim. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import sharp from "sharp";
import { chromium, expect as playwrightExpect } from "@playwright/test";

const expect = playwrightExpect.configure({ timeout: 20000 });
const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = join(root, ".artifacts");
const base = (process.env.TEST_URL || "http://localhost:3001").replace(/\/$/, "");
const targetPath = join(root, "public", "assets", "target.png");
const blankPath = join(artifacts, "photo-blank-negative.png");
const portraitPath = join(artifacts, "photo-target-portrait.png");
const squarePath = join(artifacts, "photo-target-square.png");
const checks = [];
const errors = [];
const posts = [];
const startedAt = new Date().toISOString();
const args = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--use-fake-device-for-media-stream"];
const executable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {};
let failure;

await mkdir(artifacts, { recursive: true });
await sharp({ create: { width: 1000, height: 750, channels: 3, background: "#dad8d0" } }).png().toFile(blankPath);
await sharp(targetPath).resize(900, 1200, { fit: "contain", background: "#ffffff" }).png().toFile(portraitPath);
await sharp(targetPath).resize(1000, 1000, { fit: "contain", background: "#ffffff" }).png().toFile(squarePath);

async function instrument(context) {
  await context.addInitScript(() => {
    globalThis.__atlasPhotoCameraRequests = 0;
    if (navigator.mediaDevices?.getUserMedia) {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (...args) => {
        globalThis.__atlasPhotoCameraRequests += 1;
        return original(...args);
      };
    }
  });
}

const browser = await chromium.launch({ headless: true, args: [...args, "--use-fake-ui-for-media-stream"], ...executable });
const context = await browser.newContext({ viewport: { width: 900, height: 900 }, reducedMotion: "reduce" });
await instrument(context);
const page = await context.newPage();
page.setDefaultTimeout(20000);
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => { if (request.method() === "POST") posts.push(request.url()); });

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

async function screenshot(current, filename) {
  await current.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await current.screenshot({ path: join(artifacts, filename), fullPage: true, animations: "disabled" });
}

async function openPhotoEntry(current) {
  await current.getByRole("button", { name: "View in your space", exact: true }).click();
  await expect(current.locator(".ar-intro").getByRole("button", { name: "Use a photo target", exact: true })).toBeVisible();
  return current.getByLabel("Photo for target recognition", { exact: true });
}

async function noCamera(current = page) {
  assert.equal(await current.evaluate(() => globalThis.__atlasPhotoCameraRequests), 0, "Unmatched/invalid photos must never open a camera");
  await expect(current.locator(".photo-verified-placement, .free-placement")).toHaveCount(0);
  await expect(current.locator(".ar-overlay video")).toHaveCount(0);
  await expect(current.locator(".ar-photo-source")).toHaveCount(0);
}

async function recognizeAndPlace(path, expectedRequests) {
  await page.getByLabel("Photo for target recognition", { exact: true }).setInputFiles(path);
  const wrapper = page.locator('.photo-verified-placement[data-activation="photo-target"]');
  await expect(wrapper).toBeVisible({ timeout: 60000 });
  const placement = wrapper.locator(".free-placement");
  await expect(placement).toHaveAttribute("data-mode", "manual", { timeout: 30000 });
  await expect(placement.locator(".fp-camera-video")).toBeVisible();
  await expect.poll(() => placement.locator(".fp-camera-video").evaluate((video) => video.readyState >= 2 && video.videoWidth > 0 && video.srcObject?.getTracks().some((track) => track.readyState === "live"))).toBe(true);
  await expect(placement.locator(".fp-render-canvas")).toBeVisible();
  assert.equal(await page.evaluate(() => globalThis.__atlasPhotoCameraRequests), expectedRequests, "The verified-photo handoff should open exactly one live stream");
  await expect(page.locator(".ar-photo-source")).toHaveCount(0);
  await expect(page.getByText("Static photo preview", { exact: true })).toHaveCount(0);
  return placement;
}

async function exitPlacement() {
  const tracks = await page.locator(".fp-camera-video").evaluateHandle((video) => video.srcObject.getTracks());
  await page.locator(".free-placement").getByRole("button", { name: "Back to 3D", exact: true }).click();
  await expect(page.locator(".free-placement")).toHaveCount(0);
  await expect.poll(() => tracks.evaluate((items) => items.every((track) => track.readyState === "ended"))).toBe(true);
  await tracks.dispose();
  await expect(page.locator(".fp-camera-video, .fp-render-canvas, .ar-photo-source")).toHaveCount(0);
  await expect(page.locator(".experience-info > h1")).toHaveText("The Courtyard");
  await expect(page.locator(".model-viewer canvas")).toHaveCount(1);
}

try {
  await page.goto(`${base}/experience/`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".experience-info > h1")).toHaveText("The Courtyard");
  await expect(page.getByRole("button", { name: "Explore Main entrance", exact: true })).toBeVisible({ timeout: 40000 });

  await check("Photo-target entry does not open the live camera before recognition", async () => {
    const input = await openPhotoEntry(page);
    await expect(input).toHaveAttribute("accept", "image/*");
    await noCamera();
  });

  await check("Blank photo has no match and cannot activate live placement", async () => {
    await page.getByLabel("Photo for target recognition", { exact: true }).setInputFiles(blankPath);
    await expect(page.locator(".ar-view")).toHaveClass(/ar-state-photo-no-match/, { timeout: 40000 });
    await expect(page.locator(".ar-state-photo-no-match .ar-intro h1")).toHaveText("No matching target found in this photo");
    await noCamera();
    await screenshot(page, "photo-blank-does-not-activate.png");
  });

  await check("Renamed invalid image is rejected without requesting camera access", async () => {
    await page.getByLabel("Photo for target recognition", { exact: true }).setInputFiles({ name: "invalid.png", mimeType: "image/png", buffer: Buffer.from("This is malformed text rather than an encoded PNG photo.") });
    await expect(page.locator(".ar-view")).toHaveClass(/ar-state-error/);
    await expect(page.locator(".ar-intro")).toContainText("Choose an actual JPEG, PNG or WebP photo");
    await noCamera();
  });

  await check("Real target recognition hands off to a live camera rather than placing on the photo", async () => {
    const placement = await recognizeAndPlace(targetPath, 1);
    await expect(placement.locator(".fp-status")).toContainText("Manual camera preview");
    await expect(placement).toContainText("Screen-relative placement");
    await screenshot(page, "photo-verified-live-camera-placement.png");
  });

  await check("Manual placement offers truthful movement, scale, floors and reset controls", async () => {
    const placement = page.locator(".free-placement");
    for (const name of ["Rotate left", "Rotate right", "Make building larger", "Make building smaller"]) {
      await expect(placement.getByRole("button", { name, exact: true })).toBeEnabled();
      await placement.getByRole("button", { name, exact: true }).click();
    }
    await placement.getByRole("combobox", { name: "Placement floor", exact: true }).selectOption("floor-2");
    const bounds = await placement.locator(".fp-camera-host").boundingBox();
    assert.ok(bounds);
    await page.mouse.move(bounds.x + bounds.width * 0.45, bounds.y + bounds.height * 0.42);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.48, { steps: 5 });
    await page.mouse.up();
    await placement.getByRole("button", { name: "Reset placement", exact: true }).click();
    await expect(placement.getByRole("combobox", { name: "Placement floor", exact: true })).toHaveValue("");
    await expect(placement).toHaveAttribute("data-mode", "manual");
    assert.equal(await page.evaluate(() => globalThis.__atlasPhotoCameraRequests), 1);
    await exitPlacement();
  });

  await check("Portrait and square target photos both activate fresh live streams and clean up", async () => {
    for (const [path, requests, label] of [[portraitPath, 2, "portrait"], [squarePath, 3, "square"]]) {
      await openPhotoEntry(page);
      await recognizeAndPlace(path, requests);
      await screenshot(page, `photo-${label}-verified-live-placement.png`);
      await exitPlacement();
    }
    await screenshot(page, "photo-placement-returned-to-3d.png");
  });

  await check("Actual camera denial after a verified photo has useful recovery", async () => {
    // Fake-UI auto-allow overrides denial, so use a distinct browser without it.
    const deniedBrowser = await chromium.launch({ headless: true, args, ...executable });
    try {
      const deniedContext = await deniedBrowser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
      await instrument(deniedContext);
      const deniedPage = await deniedContext.newPage();
      deniedPage.on("pageerror", (error) => errors.push(error.message));
      await deniedPage.goto(`${base}/experience/`, { waitUntil: "domcontentloaded" });
      await expect(deniedPage.locator(".experience-info > h1")).toHaveText("The Courtyard");
      const cdp = await deniedContext.newCDPSession(deniedPage);
      const { targetInfo } = await cdp.send("Target.getTargetInfo");
      await cdp.send("Browser.setPermission", { permission: { name: "camera" }, setting: "denied", origin: new URL(deniedPage.url()).origin, browserContextId: targetInfo.browserContextId });
      const input = await openPhotoEntry(deniedPage);
      await noCamera(deniedPage);
      await input.setInputFiles(targetPath);
      const placement = deniedPage.locator('.photo-verified-placement[data-activation="photo-target"] .free-placement');
      await expect(placement).toHaveAttribute("data-mode", "denied", { timeout: 60000 });
      assert.equal(await deniedPage.evaluate(() => globalThis.__atlasPhotoCameraRequests), 1);
      await expect(placement.locator(".fp-camera-video")).toHaveCount(0);
      await expect(placement.getByRole("button", { name: "Back to 3D", exact: true })).toBeVisible();
      await screenshot(deniedPage, "photo-verified-camera-denied-mobile.png");
      await placement.getByRole("button", { name: "Back to 3D", exact: true }).click();
      await expect(deniedPage.locator(".free-placement")).toHaveCount(0);
    } finally { await deniedBrowser.close(); }
  });

  assert.deepEqual(posts, [], "Photo selection/verification must not upload image bytes");
  assert.deepEqual(errors, [], "Photo verification, placement and cleanup must not produce uncaught page errors");
} catch (error) {
  failure = error;
  console.error(error);
  await screenshot(page, "browser-photo-failure.png").catch(() => {});
} finally {
  await writeFile(join(artifacts, "browser-photo-results.json"), JSON.stringify({
    startedAt, completedAt: new Date().toISOString(), base, checks, errors, posts,
    physicalDeviceTested: false,
    method: "Actual MindAR matches selected PNGs before handoff to a live synthetic camera. Unmatched/invalid photos request no camera. Native getUserMedia is counted and delegated unchanged; separate Chromium native permission denial covers recovery. Manual mode is screen-relative, not world tracking. No recognition callbacks are mocked.",
    passed: !failure, ...(failure ? { failure: failure.message } : {}),
  }, null, 2));
  await browser.close();
}
if (failure) process.exitCode = 1;
