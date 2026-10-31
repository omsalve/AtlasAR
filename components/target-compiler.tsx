"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ImagePlus, LoaderCircle, X } from "lucide-react";
import { createId } from "@/lib/id";

type Props = { onCompiled: (mind: File, image: File) => void; onError?: (message: string) => void };

/** Compile entirely on this device, in a disposable iframe to isolate GPU/worker resources. */
export default function TargetCompiler({ onCompiled, onError }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [complete, setComplete] = useState(false);
  const cleanup = useRef<(() => void) | null>(null);
  const frameMount = useRef<HTMLDivElement>(null);
  const running = useRef(false);
  useEffect(() => () => cleanup.current?.(), []);

  function cancel() {
    cleanup.current?.(); cleanup.current = null; running.current = false;
    setBusy(false); setMessage("Compilation cancelled. You can try again.");
  }

  async function compile() {
    if (!file || running.current) return;
    if (file.size === 0 || file.size > 8 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setMessage("Choose a PNG, JPEG or WebP image up to 8 MiB."); return;
    }
    running.current = true; setBusy(true); setProgress(0); setMessage(""); setComplete(false);
    const frame = document.createElement("iframe");
    frame.src = "/vendor/mindar/compiler.html";
    frame.title = "Local target compilation";
    // Keep the document visible inside the modal's top layer. An offscreen or
    // inert document can have animation frames/workers throttled by the browser.
    frame.style.cssText = "display:block;width:100%;height:24px;border:0;background:transparent";
    const token = createId();
    const finish = () => {
      clearTimeout(timeout); window.removeEventListener("message", receive); frame.remove();
      cleanup.current = null; running.current = false;
    };
    const fail = (text: string) => { finish(); setBusy(false); setMessage(text); onError?.(text); };
    const receive = async (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.origin !== location.origin || event.data?.source !== "atlasar-target-compiler") return;
      const data = event.data;
      if (data.type === "ready") {
        try {
          const bytes = await file.arrayBuffer();
          if (running.current) frame.contentWindow?.postMessage({ type: "compile", token, bytes, mime: file.type }, location.origin, [bytes]);
        } catch { fail("The selected image could not be read. Choose it again."); }
        return;
      }
      if (data.token !== token) return;
      if (data.type === "progress" && typeof data.progress === "number") setProgress(Math.min(99, Math.max(0, Math.round(data.progress))));
      if (data.type === "error") fail(typeof data.message === "string" ? data.message : "Target compilation failed. Try a smaller image.");
      if (data.type === "complete" && data.bytes instanceof ArrayBuffer) {
        const mind = new File([data.bytes], `${file.name.replace(/\.[^.]+$/, "")}.mind`, { type: "application/octet-stream" });
        finish(); setBusy(false); setProgress(100); setComplete(true);
        onCompiled(mind, file);
      }
    };
    cleanup.current = finish;
    window.addEventListener("message", receive);
    const timeout = setTimeout(() => fail("Compilation took too long. Try a detailed image around 800 × 600 pixels and close other demanding tabs."), 180_000);
    if (frameMount.current) frameMount.current.appendChild(frame);
    else fail("The compilation workspace could not open. Close this dialog and try again.");
  }

  return <div className="target-compiler">
    <p className="muted">Choose the image visitors will scan. Its tracking data is compiled here in your browser; your image stays on this device.</p>
    <label className="upload-zone" style={{ display: "flex", gap: 12, alignItems: "center", padding: 24, border: "1px dashed #b5b9aa", borderRadius: 12, cursor: busy ? "wait" : "pointer" }}>
      <ImagePlus size={26} aria-hidden="true"/><span><strong>{file?.name || "Choose a target image"}</strong><small style={{ display: "block", marginTop: 6 }}>PNG, JPEG or WebP · 8 MiB maximum</small></span>
      <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Target image to compile" disabled={busy} onChange={e => { setFile(e.target.files?.[0] || null); setComplete(false); setMessage(""); }} style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}/>
    </label>
    <p className="small-print">Use a detailed, asymmetric image with contrast. Avoid logos alone, plain gradients, repeated patterns and glare. Each side must be 256–2048 pixels; 800–1200 pixels is usually enough.</p>
    <div ref={frameMount} hidden={!busy} style={{ marginTop: busy ? 18 : 0 }}/>
    {busy && <div role="status"><p className="small-print">{progress < 50 ? "Finding visual features…" : "Preparing tracking data…"} {progress}% · Keep this tab open.</p></div>}
    {message && <p role="alert" className="form-error">{message}</p>}
    {complete && <p role="status" style={{ display: "flex", gap: 8, color: "#536d3f" }}><Check size={18}/>Target compiled and added to this project.</p>}
    <div style={{ display: "flex", gap: 10, marginTop: 18 }}><button className="button primary" disabled={!file || busy} onClick={compile}>{busy ? <LoaderCircle size={16} className="spin"/> : <ImagePlus size={16}/>} {busy ? "Compiling target…" : "Compile & use target"}</button>{busy && <button className="button secondary" onClick={cancel}><X size={16}/>Cancel</button>}</div>
  </div>;
}
