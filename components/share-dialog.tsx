"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ArrowDownToLine, ArrowUpRight, Check, Copy, Globe, HardDrive, QrCode } from "lucide-react";
import type { Project } from "@/lib/project";
import { publishProject } from "@/lib/storage";
import { downloadBlob, exportProjectPackage, hasLocalAssets, projectUrl } from "@/lib/publish";
import { Modal } from "./ui";

export default function ShareDialog({ project, open, onClose, onPublished }: { project: Project | null; open: boolean; onClose: () => void; onPublished?: (project: Project) => void }) {
  const [origin, setOrigin] = useState("");
  const [url, setUrl] = useState("");
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<Project | null>(null);
  useEffect(() => { if (!open || !project) return; let active = true; queueMicrotask(() => { if (active) { setOrigin(window.location.origin); setSnapshot(project); setError(""); setCopied(false); } }); return () => { active = false; }; }, [open, project]);
  useEffect(() => { if (!snapshot || !origin || !open) return; let active = true; try { const link = projectUrl(snapshot, origin); QRCode.toDataURL(link, { width: 500, margin: 3, color: { dark: "#26382b", light: "#ffffff" }, errorCorrectionLevel: "L" }).then(data => { if (active) { setUrl(link); setQr(data); setError(""); } }).catch((e: Error) => { if (active) setError(e.message); }); } catch (e) { queueMicrotask(() => { if (active) { setUrl(""); setError((e as Error).message); } }); } return () => { active = false; }; }, [snapshot, origin, open]);
  async function publish() { if (!snapshot) return; setBusy(true); try { const saved = await publishProject(snapshot); setSnapshot(saved); onPublished?.(saved); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function copy() { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setError("Clipboard access is unavailable. Select and copy the URL below."); } }
  async function downloadQr() { try { const svg = await QRCode.toString(url, { type: "svg", width: 700, margin: 4, errorCorrectionLevel: "L", color: { dark: "#26382b" } }); downloadBlob(new Blob([svg], {type:"image/svg+xml"}), `${snapshot?.id}-qr.svg`); } catch (e) { setError((e as Error).message); } }
  async function exportPackage() { if (!snapshot) return; setBusy(true); try { downloadBlob(await exportProjectPackage(snapshot), `${snapshot.id}.zip`); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <Modal open={open} onClose={onClose} title="Let them step into your vision" className="share-modal"><p className="muted">{snapshot?.name} · {snapshot?.status === "published" ? "Published configuration" : "Draft configuration"}</p><div className="share-layout"><div className="qr-frame">{qr ? <img src={qr} alt={`QR code for ${snapshot?.name}`}/> : <QrCode size={80}/>}<span>SCAN. EXPLORE. EXPERIENCE.</span></div><div className="share-description"><span className="pill"><Globe size={13}/>NO APP REQUIRED</span><h3>A small code.<br/>A whole new world.</h3><p>This QR opens your experience. Visitors then scan the separate image target to see the building in AR.</p><button className="button secondary" onClick={downloadQr} disabled={!url}><ArrowDownToLine size={15}/>Download QR SVG</button></div></div><label className="field-label" htmlFor="hosting-origin">Website origin</label><input id="hosting-origin" className="text-input" type="url" value={origin} onChange={e => setOrigin(e.target.value)} placeholder="https://your-site.pages.dev"/><div className="share-url"><input aria-label="Experience URL" value={url} readOnly onFocus={e => e.currentTarget.select()}/><button className="icon-button" onClick={copy} aria-label="Copy experience URL">{copied ? <Check size={17}/> : <Copy size={17}/>}</button></div>
    <div className="notice"><HardDrive size={18}/><p>{snapshot && hasLocalAssets(snapshot) ? "This project uses device-local uploads. Export and host its package before sharing this URL with another device." : "This link carries the project configuration. Its assets must be reachable at the selected website origin."}{origin.includes("localhost") || origin.includes("127.0.0.1") ? " Localhost cannot be opened from another device. Use a reachable HTTPS origin for camera access." : " Use HTTPS for mobile camera access."}</p></div>{error && <p role="alert" className="inline-error">{error}</p>}<div className="share-actions"><button className="button secondary" onClick={exportPackage} disabled={busy}><ArrowDownToLine size={16}/>Export project package</button>{snapshot?.status === "draft" ? <button className="button primary" onClick={publish} disabled={busy}>{busy ? "Publishing…" : "Publish local snapshot"}</button> : <a className="button primary" href={url} target="_blank" rel="noreferrer">Open experience<ArrowUpRight size={16}/></a>}</div><p className="small-print">Publication saves a snapshot in this browser. Hosting and deployment are separate steps.</p></Modal>;
}
