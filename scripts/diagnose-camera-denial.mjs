/** Diagnose actual Chromium permission behavior using fake devices only; no physical camera. */
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.TEST_URL || "http://localhost:3000";
const browser = await chromium.launch({ headless: true, args: ["--use-fake-device-for-media-stream", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
try {
  for (const method of ["cdp-setPermission", "grant-empty-permissions"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push({ name: error.name, message: error.message }));
      await page.goto(`${base}/experience/`, { waitUntil: "domcontentloaded" });
      const cdp = await context.newCDPSession(page);
      const { targetInfo } = await cdp.send("Target.getTargetInfo");
      const before = await page.evaluate(async () => ({ camera: (await navigator.permissions.query({ name: "camera" })).state, secure: isSecureContext, userAgent: navigator.userAgent }));
      if (method === "cdp-setPermission") await cdp.send("Browser.setPermission", { permission: { name: "camera" }, setting: "denied", origin: new URL(base).origin, browserContextId: targetInfo.browserContextId });
      else await context.grantPermissions([], { origin: new URL(base).origin });
      const raw = await page.evaluate(async () => {
        const permission = (await navigator.permissions.query({ name: "camera" })).state;
        const result = await Promise.race([
          navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } }).then(stream => {
            const tracks = stream.getTracks().map(track => ({ kind: track.kind, state: track.readyState })); stream.getTracks().forEach(track => track.stop()); return { outcome: "stream", tracks };
          }).catch(error => ({ outcome: "error", name: error.name, message: error.message, constructor: error.constructor?.name, domException: error instanceof DOMException, code: error.code, string: String(error) })),
          new Promise(resolve => setTimeout(() => resolve({ outcome: "timeout" }), 10_000))
        ]);
        return { permission, result };
      });
      await page.getByRole("button", { name: "View in your space" }).click();
      await page.getByRole("button", { name: "Start camera AR" }).click();
      await page.waitForFunction(() => !["ar-state-requesting", "ar-state-initializing"].some(state => document.querySelector(".ar-view")?.classList.contains(state)), undefined, { timeout: 20_000 }).catch(() => {});
      const ui = await page.locator(".ar-view").evaluate(element => ({ state: element.className, text: element.querySelector(".ar-intro")?.textContent }));
      const record = { method, browser: await browser.version(), before, raw, ui, errors };
      results.push(record); console.log(JSON.stringify(record, null, 2));
    } finally { await context.close(); }
  }
  await mkdir(".artifacts", { recursive: true });
  await writeFile(".artifacts/camera-denial-diagnostic.json", JSON.stringify(results, null, 2));
} finally { await browser.close(); }
