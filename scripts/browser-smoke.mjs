import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
await mkdir(".artifacts", { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if(message.type()==="error"&&!message.text().includes("404")) { errors.push(message.text()); console.error("Browser console:",message.text()); } });
const checks = [];
async function check(name, fn) { await fn(); checks.push(name); console.log(`PASS ${name}`); }
const base = process.env.TEST_URL || "http://localhost:3000";
try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await check("Workspace renders seeded projects", async () => { await expect(page.locator(".project-grid")).toHaveAttribute("aria-busy","false"); await expect(page.getByRole("heading", { name: "Your projects" })).toBeVisible(); await expect(page.locator(".project-card")).toHaveCount(3); });
  await page.screenshot({ path: ".artifacts/workspace-desktop.png", fullPage: true });
  await check("Search and filters", async () => { await page.getByRole("textbox", {name:"Search projects"}).fill("North"); await expect(page.locator(".project-card")).toHaveCount(1); await page.getByRole("textbox", {name:"Search projects"}).fill(""); await page.getByRole("button", {name:"Published",exact:true}).click(); await expect(page.locator(".project-card")).toHaveCount(1); await page.getByRole("button", {name:"All projects"}).click(); });
  await check("Create and persist a project", async () => { await page.getByRole("button", {name:"Create project",exact:true}).first().click(); await page.getByRole("textbox",{name:"Project name",exact:true}).fill("Browser QA Residence"); await page.getByRole("dialog").getByRole("button",{name:"Create project",exact:true}).click(); await expect(page).toHaveURL(/editor/); await expect(page.getByRole("textbox",{name:"Project name",exact:true})).toHaveValue("Browser QA Residence"); });
  await check("Actual WebGL building loads", async () => { await expect(page.locator("canvas")).toHaveCount(1); await expect(page.locator(".viewer-status")).toHaveCount(0,{timeout:30000}); await expect(page.getByRole("button",{name:"Explore Main entrance",exact:true})).toBeVisible(); });
  const projectId = new URL(page.url()).searchParams.get("project");
  await check("Rotation and zoom change the actual scene camera",async()=>{
    const x=page.getByRole("spinbutton",{name:"Overview position X",exact:true});
    const original=Number(await x.inputValue());
    await page.getByRole("button",{name:"Zoom in",exact:true}).click();
    await page.getByRole("button",{name:"Use current camera view",exact:true}).click();
    const zoomed=Number(await x.inputValue());
    if(Math.abs(zoomed-original)<.1)throw new Error("Zoom did not move the actual camera.");
    const box=await page.locator("canvas").boundingBox();
    await page.mouse.move(box.x+25,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+125,box.y+box.height*.4,{steps:10});await page.mouse.up();
    await page.getByRole("button",{name:"Use current camera view",exact:true}).click();
    if(Math.abs(Number(await x.inputValue())-zoomed)<.1)throw new Error("Drag rotation did not move the actual camera.");
  });
  await page.screenshot({ path: ".artifacts/editor-desktop.png", fullPage: true });
  await check("Edit, save and reload", async () => { await page.getByRole("textbox",{name:"Location",exact:true}).fill("QA Test Location"); await page.getByRole("button",{name:"Save",exact:true}).click(); await expect(page.getByRole("status")).toContainText("Project saved"); await page.reload({waitUntil:"domcontentloaded"}); await expect(page.getByRole("textbox",{name:"Location",exact:true})).toHaveValue("QA Test Location"); });
  await check("POI editor and camera capture", async () => { await page.getByRole("tab",{name:"POIs",exact:true}).click(); await page.locator(".poi-editor-list").getByRole("button",{name:"Swimming pool"}).click(); await page.getByRole("textbox",{name:"Display name"}).fill("Garden pool"); await page.getByRole("button",{name:"Capture current viewpoint"}).click(); await page.getByRole("button",{name:"Save",exact:true}).click(); });
  await check("Floor control and interior", async () => { await page.getByLabel("Preview floor").selectOption("floor-2"); await page.getByRole("button",{name:"Interior",exact:true}).click(); await expect(page.getByRole("heading",{name:"Room to imagine."})).toBeVisible(); await expect(page.locator(".viewer-status")).toHaveCount(0,{timeout:20000}); await page.getByRole("button",{name:"Building",exact:true}).click(); });
  await check("Publish snapshot and generate QR", async () => { await page.getByRole("button",{name:"Publish",exact:true}).click(); await expect(page.getByRole("dialog")).toBeVisible(); await expect(page.locator(".qr-frame img")).toBeVisible(); const link = await page.getByRole("textbox",{name:"Experience URL"}).inputValue(); if(!link.includes("#p="))throw new Error("Missing portable project manifest"); await page.getByRole("button",{name:"Close dialog",exact:true}).last().click(); });
  await check("Published scene and POIs", async () => { await page.goto(`${base}/experience/?project=${projectId}`,{waitUntil:"domcontentloaded"}); await expect(page.locator(".experience-info>h1")).toHaveText("Browser QA Residence"); await expect(page.locator(".viewer-status")).toHaveCount(0,{timeout:30000}); await page.locator(".poi-ribbon-items").getByRole("button",{name:/Garden pool/}).click(); await expect(page.locator(".selected-poi-info>h2")).toHaveText("Garden pool"); await page.locator(".poi-ribbon-items").getByRole("button",{name:/Sample residence/}).click(); await page.getByRole("button",{name:"Explore the interior",exact:true}).click(); await expect(page.locator(".experience-info>h1")).toHaveText("Step inside."); await expect(page.locator(".viewer-status")).toHaveCount(0,{timeout:30000}); await page.getByRole("button",{name:"Return to building",exact:true}).click(); });
  await page.screenshot({path:".artifacts/experience-desktop.png",fullPage:true});
  await check("Mobile viewport without horizontal overflow", async () => { await page.setViewportSize({width:390,height:844}); await page.goto(base,{waitUntil:"domcontentloaded"}); await expect(page.locator(".project-grid")).toHaveAttribute("aria-busy","false"); const sizes=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})); if(sizes.scroll>sizes.width+1)throw new Error(`Horizontal overflow ${JSON.stringify(sizes)}`); await page.screenshot({path:".artifacts/workspace-mobile.png",fullPage:true}); await page.goto(`${base}/editor/?project=${projectId}`,{waitUntil:"domcontentloaded"}); await expect(page.getByRole("textbox",{name:"Project name",exact:true})).toBeVisible(); await expect(page.locator("canvas")).toHaveCount(1); await expect(page.getByRole("button",{name:"Explore Main entrance",exact:true})).toBeVisible(); await expect(page.locator(".viewer-status")).toHaveCount(0,{timeout:30000}); await page.screenshot({path:".artifacts/editor-mobile.png",fullPage:true}); await page.goto(`${base}/experience/`,{waitUntil:"domcontentloaded"}); await expect(page.locator("canvas")).toHaveCount(1); await expect(page.getByRole("button",{name:"Explore Main entrance",exact:true})).toBeVisible(); await expect(page.locator(".viewer-status")).toHaveCount(0,{timeout:30000}); await page.screenshot({path:".artifacts/experience-mobile.png",fullPage:true}); });
  await check("AR camera entry and safe fallback", async () => { await page.getByRole("button",{name:"View in your space"}).click(); await expect(page.locator(".ar-overlay")).toBeVisible(); await page.screenshot({path:".artifacts/ar-entry.png",fullPage:true}); });
  if(errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
  await writeFile(".artifacts/browser-results.json",JSON.stringify({checks,errors,physicalDeviceTested:false},null,2));
} finally { await browser.close(); }
