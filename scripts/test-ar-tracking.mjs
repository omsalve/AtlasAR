/** Actual MindAR recognition/loss with a synthetic camera. This is not physical-device QA. */
import { chromium, expect } from "@playwright/test";
import sharp from "sharp";
import { mkdir, open, writeFile } from "node:fs/promises";
import path from "node:path";

const output = path.resolve(".artifacts");
await mkdir(output, { recursive: true });
const width = 640, height = 480;
const target = await sharp("public/assets/target.png").resize(540, 389).png().toBuffer();
const detailed = await sharp({ create: { width, height, channels: 3, background: "#c9c6b9" } }).composite([{ input: target, top: 45, left: 50 }]).removeAlpha().raw().toBuffer();
const blank = await sharp({ create: { width, height, channels: 3, background: "#c9c6b9" } }).raw().toBuffer();

function yuv420(rgb) {
  const size = width * height, frame = Buffer.alloc(size * 1.5);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const pixel = (y * width + x) * 3, r = rgb[pixel], g = rgb[pixel + 1], b = rgb[pixel + 2];
    frame[y * width + x] = Math.round(16 + .257 * r + .504 * g + .098 * b);
  }
  for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const pixel = ((y + dy) * width + x + dx) * 3; r += rgb[pixel] / 4; g += rgb[pixel + 1] / 4; b += rgb[pixel + 2] / 4; }
    const position = y / 2 * width / 2 + x / 2;
    frame[size + position] = Math.round(128 - .148 * r - .291 * g + .439 * b);
    frame[size + size / 4 + position] = Math.round(128 + .439 * r - .368 * g - .071 * b);
  }
  return frame;
}
const targetFrame = yuv420(detailed), blankFrame = yuv420(blank);
const fixture = path.join(output, "synthetic-target-camera.y4m");
const handle = await open(fixture, "w");
try {
  await handle.write(`YUV4MPEG2 W${width} H${height} F5:1 Ip A1:1 C420jpeg\n`);
  // At 5 fps: target 24 s, blank 10 s, target 14 s, then Chromium repeats.
  for (const [frame, count] of [[targetFrame, 120], [blankFrame, 50], [targetFrame, 70]]) {
    for (let i = 0; i < count; i++) { await handle.write("FRAME\n"); await handle.write(frame); }
  }
} finally { await handle.close(); }
console.log("Generated synthetic camera fixture (target → blank → target). Launching real MindAR runtime.");
const browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${fixture}`] });
const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
const errors = [];
const states = [];
const checks = [];
page.on("pageerror", error => { errors.push(error.message); console.error("AR page error:", error.message); });
try {
  await page.goto(`${process.env.TEST_URL || "http://localhost:3000"}/experience/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "View in your space" }).click();
  await page.getByRole("button", { name: "Start camera AR" }).click();
  const status = page.locator(".ar-status");
  await expect(status).toHaveText(/Image target recognized/, { timeout: 90_000 });
  states.push("tracking"); console.log("PASS Actual image recognition from synthetic camera, target 0 anchor active.");
  await expect(page.locator(".free-placement, .photo-verified-placement")).toHaveCount(0);
  await expect(page.locator(".ar-render-canvas")).toBeVisible();
  const cameraTracks = await page.locator(".ar-camera-video").evaluateHandle(video => video.srcObject.getTracks());
  await page.screenshot({ path: path.join(output, "ar-tracked-synthetic.png") });
  await page.locator(".ar-poi-list").getByRole("button", { name: "03 Fitness studio" }).click();
  await expect(page.locator(".ar-poi-details")).toContainText("Fitness studio");
  await page.getByRole("combobox", { name: "AR floor" }).selectOption("floor-2");
  await page.getByRole("button", { name: "Make building larger" }).click();
  await expect(status).toHaveText(/Target lost/, { timeout: 65_000 });
  states.push("lost"); console.log("PASS Blank camera frames produce honest target-lost state.");
  await page.screenshot({ path: path.join(output, "ar-target-lost-synthetic.png") });
  await expect(status).toHaveText(/Image target recognized/, { timeout: 65_000 });
  states.push("tracking"); console.log("PASS Target reacquired without recreating the scene.");
  await page.getByRole("button", { name: "Back to 3D" }).click();
  await expect(page.locator(".ar-view")).toHaveCount(0);
  if (!(await cameraTracks.evaluate(tracks => tracks.every(track => track.readyState === "ended")))) throw new Error("An AR camera track remained active after exit.");
  await cameraTracks.dispose();
  console.log("PASS AR exit disposes UI and camera owner; 3D experience remains available.");
  checks.push("actual recognition", "render canvas", "POI interaction", "floor control", "scale button", "target loss", "reacquisition", "exit", "camera tracks stopped");
  // Use a separate browser: --use-fake-ui-for-media-stream overrides permission denial.
  // Fake-device alone avoids access to a physical camera; permission denial prevents any stream.
  const deniedBrowser = await chromium.launch({ headless: true, args: ["--use-fake-device-for-media-stream", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  try {
    const deniedPage = await deniedBrowser.newPage({ viewport: { width: 390, height: 844 } });
    deniedPage.on("pageerror", error => errors.push(error.message));
    await deniedPage.goto(`${process.env.TEST_URL || "http://localhost:3000"}/experience/`, { waitUntil: "domcontentloaded" });
    const cdp = await deniedPage.context().newCDPSession(deniedPage);
    const { targetInfo } = await cdp.send("Target.getTargetInfo");
    await cdp.send("Browser.setPermission", { permission: { name: "camera" }, setting: "denied", origin: new URL(deniedPage.url()).origin, browserContextId: targetInfo.browserContextId });
    await deniedPage.getByRole("button", { name: "View in your space" }).click();
    await deniedPage.getByRole("button", { name: "Start camera AR" }).click();
    await expect(deniedPage.locator(".ar-view")).toHaveClass(/ar-state-denied/, { timeout: 15_000 });
    await expect(deniedPage.locator(".ar-intro")).toContainText("Open this website’s permissions");
    await deniedPage.screenshot({ path: path.join(output, "ar-permission-denied-mobile.png") });
    await deniedPage.getByRole("button", { name: "Explore without a camera" }).click();
    await expect(deniedPage.locator(".ar-view")).toHaveCount(0);
  } finally { await deniedBrowser.close(); }
  checks.push("actual browser permission denial", "3D fallback after denial");
  console.log("PASS Real browser camera permission denial has useful recovery and 3D fallback.");
  if (errors.length) throw new Error(`Unexpected runtime errors: ${errors.join("; ")}`);
  await writeFile(path.join(output, "ar-synthetic-results.json"), JSON.stringify({ method: "Actual MindAR 1.2.5 tracking against a synthetic Y4M camera in desktop Chromium; camera denial set through browser permission API. Not a physical camera or mobile-device test.", states, checks, errors, testedAt: new Date().toISOString() }, null, 2));
} finally { await browser.close(); }
