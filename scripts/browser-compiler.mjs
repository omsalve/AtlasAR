/** Exercise the real local target compiler through the editor UI on a static app. */
import assert from "node:assert/strict";
import { mkdir, stat, writeFile } from "node:fs/promises";
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
let projectId;
let compiledAssets;
let failure;

await mkdir(artifacts, { recursive: true });
await stat(targetPath);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
const page = await context.newPage();
page.setDefaultTimeout(20000);
page.on("pageerror", (error) => errors.push(error.message));

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

async function readyModel() {
  await expect(page.locator(".model-viewer canvas")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Explore Main entrance", exact: true })).toBeVisible({ timeout: 40000 });
  await expect(page.locator(".viewer-status")).toHaveCount(0);
}

async function readStoredTargetPair() {
  // Read-only inspection verifies persisted blobs; all writes happen through the UI.
  return page.evaluate((id) => new Promise((resolve, reject) => {
    const opening = indexedDB.open("atlasar-studio");
    opening.onerror = () => reject(new Error("Could not inspect project storage"));
    opening.onsuccess = () => {
      const database = opening.result;
      const transaction = database.transaction(["projects", "assets"], "readonly");
      let result;
      const projectRequest = transaction.objectStore("projects").get(id);
      projectRequest.onsuccess = () => {
        const project = projectRequest.result;
        if (!project) { transaction.abort(); return; }
        result = { imageUrl: project.ar.targetImageUrl, mindUrl: project.ar.targetMindUrl };
        for (const [key, url] of [["image", result.imageUrl], ["mind", result.mindUrl]]) {
          const assetRequest = transaction.objectStore("assets").get(url);
          assetRequest.onsuccess = () => {
            const asset = assetRequest.result;
            result[key] = asset ? { name: asset.name, type: asset.type, blobType: asset.blob?.type, size: asset.blob?.size, isBlob: asset.blob instanceof Blob } : null;
          };
        }
      };
      transaction.oncomplete = () => { database.close(); resolve(result); };
      transaction.onerror = () => { database.close(); reject(new Error("Could not read the stored target pair")); };
      transaction.onabort = () => { database.close(); reject(new Error("Target project was not saved")); };
    };
  }), projectId);
}

try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await check("Create a fresh compiler project and wait for its hydrated viewer", async () => {
    await expect(page.locator(".project-grid")).toHaveAttribute("aria-busy", "false");
    await page.getByRole("button", { name: "Create project", exact: true }).first().click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByRole("textbox", { name: "Project name", exact: true }).fill("Target compiler QA");
    await dialog.getByRole("button", { name: "Create project", exact: true }).click();
    await expect(page).toHaveURL(/\/editor\/\?project=/);
    await expect(page.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue("Target compiler QA");
    projectId = new URL(page.url()).searchParams.get("project");
    assert.ok(projectId);
    await readyModel();
  });

  await check("Compile and pair the actual sample image through the editor dialog", async () => {
    await page.getByRole("tab", { name: "Assets", exact: true }).click();
    await page.getByRole("button", { name: "Upload & compile a target", exact: true }).click();
    const dialog = page.locator("dialog[open]");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Target image to compile", { exact: true }).setInputFiles(targetPath);
    await dialog.getByRole("button", { name: "Compile & use target", exact: true }).click();
    await expect(page.locator(".feedback")).toContainText("Target compiled and paired", { timeout: 60000 });
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    const preview = page.locator(".target-preview img");
    await expect(preview).toHaveAttribute("src", /^blob:/);
    await expect.poll(() => preview.evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
    await expect(page.locator(".editor-project-title")).toContainText("Unsaved changes");
    // Compilation intentionally edits a draft. Save before asserting project persistence.
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator(".feedback")).toContainText("Project saved");
    compiledAssets = await readStoredTargetPair();
    assert.match(compiledAssets.imageUrl, /^idb:/);
    assert.match(compiledAssets.mindUrl, /^idb:/);
    assert.notEqual(compiledAssets.imageUrl, compiledAssets.mindUrl);
    assert.equal(compiledAssets.image?.isBlob, true);
    assert.equal(compiledAssets.mind?.isBlob, true);
    assert.equal(compiledAssets.image.type, "image/png");
    assert.equal(compiledAssets.image.blobType, "image/png");
    assert.equal(compiledAssets.mind.type, "application/octet-stream");
    assert.equal(compiledAssets.mind.blobType, "application/octet-stream");
    assert.ok(compiledAssets.image.size > 0);
    assert.ok(compiledAssets.mind.size > 0);
    await expect(page.locator(".editor-project-title")).toContainText("Saved on this device");
    await page.screenshot({ path: join(artifacts, "compiler-paired-target.png"), fullPage: true });
  });

  await check("Reload and retain both matching local target assets and decoded preview", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue("Target compiler QA");
    await readyModel();
    await page.getByRole("tab", { name: "Assets", exact: true }).click();
    const preview = page.locator(".target-preview img");
    await expect(preview).toHaveAttribute("src", /^blob:/);
    await expect.poll(() => preview.evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
    assert.deepEqual(await readStoredTargetPair(), compiledAssets);
    await expect(page.locator(".editor-project-title")).toContainText("Saved on this device");
    await page.screenshot({ path: join(artifacts, "compiler-target-reloaded.png"), fullPage: true });
  });

  assert.deepEqual(errors, [], "Compiler workflow must not produce uncaught browser errors");
} catch (error) {
  failure = error;
  console.error(error);
  await page.screenshot({ path: join(artifacts, "browser-compiler-failure.png"), fullPage: true }).catch(() => {});
} finally {
  await writeFile(join(artifacts, "browser-compiler-results.json"), JSON.stringify({
    startedAt, completedAt: new Date().toISOString(), base, checks, errors, projectId,
    compiledAssets, physicalDeviceTested: false, passed: !failure,
    ...(failure ? { failure: failure.message } : {}),
  }, null, 2));
  await browser.close();
}
if (failure) process.exitCode = 1;
