/** UI regression for local uploads, publication snapshots and portable ZIP backups. */
import assert from "node:assert/strict";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { chromium, expect as playwrightExpect } from "@playwright/test";

const expect = playwrightExpect.configure({ timeout: 20000 });
const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = join(root, ".artifacts");
const modelFile = join(root, "public", "assets", "courtyard.glb");
const base = (process.env.TEST_URL || "http://localhost:3000").replace(/\/$/, "");
const projectName = `Asset QA Residence ${Date.now()}`;
const draftName = `${projectName} revised draft`;
const checks = [];
const errors = [];
const startedAt = new Date().toISOString();
let projectId;
let importedId;
let packagePath;
let failure;

await mkdir(artifacts, { recursive: true });
await stat(modelFile);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", acceptDownloads: true });
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

async function goto(path = "/") {
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
}

async function readyModel() {
  await expect(page.locator(".model-viewer canvas")).toHaveCount(1);
  // A visible projected POI also establishes that GLTFLoader has returned a model.
  await expect(page.getByRole("button", { name: "Explore Main entrance", exact: true })).toBeVisible({ timeout: 40000 });
  await expect(page.locator(".viewer-status")).toHaveCount(0);
}

async function savedProject(id, store = "projects") {
  // Read-only persistence inspection supplements, but never replaces, UI interaction.
  return page.evaluate(({ id, store }) => new Promise((resolve, reject) => {
    const request = indexedDB.open("atlasar-studio");
    request.onerror = () => reject(new Error("Could not inspect AtlasAR storage"));
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(store, "readonly");
      const read = transaction.objectStore(store).get(id);
      read.onsuccess = () => resolve(read.result ?? null);
      read.onerror = () => reject(new Error("Could not inspect stored project"));
      transaction.oncomplete = () => database.close();
    };
  }), { id, store });
}

try {
  await goto();
  await check("Create an isolated asset-test project through the workspace", async () => {
    await expect(page.getByRole("heading", { name: "Your projects" })).toBeVisible();
    await expect(page.locator(".project-grid")).toHaveAttribute("aria-busy", "false");
    await page.getByRole("button", { name: "Create project", exact: true }).first().click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByRole("textbox", { name: "Project name", exact: true }).fill(projectName);
    await dialog.getByRole("button", { name: "Create project", exact: true }).click();
    await expect(page).toHaveURL(/\/editor\/\?project=/);
    await expect(page.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue(projectName);
    projectId = new URL(page.url()).searchParams.get("project");
    assert.ok(projectId, "Created project must have an ID");
    await readyModel();
  });

  await check("Upload a building into IndexedDB and persist it across reload", async () => {
    await page.getByRole("tab", { name: "Assets", exact: true }).click();
    await page.getByText("Replace building", { exact: true }).locator('input[type="file"]').setInputFiles(modelFile);
    await expect(page.locator(".feedback")).toContainText("courtyard.glb added.");
    await expect(page.locator(".asset-file").first()).toContainText("courtyard.glb");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator(".feedback")).toContainText("Project saved");
    assert.match((await savedProject(projectId)).model.url, /^idb:/, "Custom model must use stored Blob reference");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue(projectName);
    await readyModel();
    await page.getByRole("tab", { name: "Assets", exact: true }).click();
    await expect(page.locator(".asset-file").first()).toContainText("courtyard.glb");
    assert.match((await savedProject(projectId)).model.url, /^idb:/);
    await page.screenshot({ path: join(artifacts, "uploaded-model-reloaded.png"), fullPage: true });
  });

  await check("Reject a malformed file renamed to .glb without replacing the valid asset", async () => {
    const previousModel = (await savedProject(projectId)).model.url;
    await page.getByText("Replace building", { exact: true }).locator('input[type="file"]').setInputFiles({
      name: "renamed.glb", mimeType: "model/gltf-binary",
      buffer: Buffer.from("This is harmless malformed data rather than an actual GLB container."),
    });
    await expect(page.locator(".feedback")).toContainText("not a valid GLB 2.0");
    await expect(page.locator(".asset-file").first()).toContainText("courtyard.glb");
    assert.equal((await savedProject(projectId)).model.url, previousModel);
    await expect(page.locator(".editor-project-title")).toContainText("Saved on this device");
  });

  await check("Publish the local-upload snapshot and download its complete ZIP package", async () => {
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    const dialog = page.locator("dialog.share-modal[open]");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".qr-frame img")).toBeVisible();
    await expect(dialog.locator(".notice")).toContainText("device-local uploads");
    const visitorUrl = new URL(await dialog.getByRole("textbox", { name: "Experience URL" }).inputValue());
    assert.equal(visitorUrl.searchParams.get("project"), projectId);
    assert.equal(visitorUrl.hash, "", "Local blobs must not masquerade as portable fragment assets");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      dialog.getByRole("button", { name: "Export project package", exact: true }).click(),
    ]);
    assert.match(download.suggestedFilename(), /\.zip$/);
    packagePath = join(artifacts, `asset-package-${projectId}.zip`);
    await download.saveAs(packagePath);
    assert.ok((await stat(packagePath)).size > 1000, "ZIP should include actual uploaded model bytes");
    await expect.poll(async () => (await savedProject(projectId, "published"))?.name).toBe(projectName);
    await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();
  });

  await check("Save a changed draft without altering its published snapshot", async () => {
    await page.getByRole("tab", { name: "Project", exact: true }).click();
    await page.getByRole("textbox", { name: "Project name", exact: true }).fill(draftName);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator(".feedback")).toContainText("Project saved");
    assert.equal((await savedProject(projectId)).name, draftName);
    assert.equal((await savedProject(projectId, "published")).name, projectName);
    await goto(`/experience/?project=${projectId}`);
    await expect(page.locator(".experience-info > h1")).toHaveText(projectName);
    await readyModel();
    await expect(page.locator(".preview-banner")).toHaveCount(0);
    await goto(`/experience/?preview=${projectId}`);
    await expect(page.locator(".experience-info > h1")).toHaveText(draftName);
    await expect(page.locator(".preview-banner")).toBeVisible();
    await readyModel();
  });

  await check("Import the exported ZIP as a new project copy through the workspace", async () => {
    await goto();
    await expect(page.locator(".project-grid")).toHaveAttribute("aria-busy", "false");
    const originalCount = await page.locator(".project-card").count();
    await expect(page.getByRole("button", { name: "Import project", exact: true })).toBeEnabled();
    await page.locator('input[type="file"][accept=".zip"]').setInputFiles(packagePath);
    await expect(page.locator(".feedback")).toContainText("was imported", { timeout: 40000 });
    await expect(page.locator(".project-card")).toHaveCount(originalCount + 1);
    const importedLink = page.getByRole("link", { name: `Edit ${projectName}`, exact: true });
    await expect(importedLink).toBeVisible();
    importedId = new URL(await importedLink.getAttribute("href"), base).searchParams.get("project");
    assert.ok(importedId && importedId !== projectId, "Import must copy rather than overwrite an existing project");
    assert.equal((await savedProject(projectId)).name, draftName, "Original draft must be preserved");
    assert.equal((await savedProject(importedId)).name, projectName);
    assert.match((await savedProject(importedId)).model.url, /^idb:/);
    assert.notEqual((await savedProject(importedId)).model.url, (await savedProject(projectId)).model.url, "Backup restores a distinct local asset record");
    await importedLink.click();
    await expect(page.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue(projectName);
    await readyModel();
    await page.getByRole("tab", { name: "Assets", exact: true }).click();
    await expect(page.locator(".asset-file").first()).toContainText("courtyard.glb");
    await page.screenshot({ path: join(artifacts, "imported-package-preview.png"), fullPage: true });
  });

  await check("Reload the imported project and preview its restored uploaded model", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue(projectName);
    await readyModel();
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`preview=${importedId}`));
    await expect(page.locator(".experience-info > h1")).toHaveText(projectName);
    await readyModel();
    await page.screenshot({ path: join(artifacts, "imported-package-experience.png"), fullPage: true });
  });

  assert.deepEqual(errors, [], "No uncaught browser errors should occur during package workflows");
} catch (error) {
  failure = error;
  console.error(error);
  await page.screenshot({ path: join(artifacts, "browser-packages-failure.png"), fullPage: true }).catch(() => {});
} finally {
  await writeFile(join(artifacts, "browser-packages-results.json"), JSON.stringify({
    startedAt, completedAt: new Date().toISOString(), base, checks, errors,
    projectId, importedId, packagePath, physicalDeviceTested: false,
    passed: !failure, ...(failure ? { failure: failure.message } : {}),
  }, null, 2));
  await browser.close();
}
if (failure) process.exitCode = 1;
