"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import * as THREE from "three";
import { ArrowLeft, ArrowRight, Camera, Check, ImagePlus, Layers3, LoaderCircle, Minus, Plus, RotateCcw, ScanLine, X } from "lucide-react";
import type { Project } from "@/lib/project";
import { applyFloorVisibility, disposeObject, loadModel } from "@/lib/scene";
import { resolveAssetUrl } from "@/lib/storage";
import { recognizePhoto } from "@/lib/recognize-photo";
import { loadTrackingLibrary } from "@/lib/mindar";
import AssetImage from "./asset-image";
import "./ar-view.css";
import "./photo-preview.css";

type State = "idle" | "initializing" | "requesting" | "searching" | "tracking" | "lost" | "photo-verified" | "photo-no-match" | "denied" | "unsupported" | "error";
type Props = { project: Project; selectedPoi?: string | null; floor?: string | null; onExit: () => void; onInterior?: () => void };
type Session = { release: () => void; model?: THREE.Group; transform?: THREE.Group; focus?: THREE.Mesh; scale: number };
const FreePlacement = dynamic(() => import("./free-placement"), { ssr: false, loading: () => <div className="ar-handoff" role="status">Target verified. Opening live camera placement…</div> });

function cameraError(error: unknown): { state: State; message: string } {
  // Browser/native exceptions may originate in another realm; inspect their fields.
  const fields = typeof error === "object" && error !== null ? error as { name?: unknown; message?: unknown } : {};
  const name = typeof fields.name === "string" ? fields.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return { state: "denied", message: "Camera access was blocked. Open this website’s permissions in your browser, allow the camera, then try again. In-app browsers may require opening the link in Safari or Chrome." };
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return { state: "unsupported", message: "No camera is available. Open this experience on a phone or continue exploring in 3D." };
  if (name === "NotReadableError" || name === "TrackStartError") return { state: "error", message: "The camera is busy or unavailable. Close other camera apps and tabs, then try again." };
  if (name === "NotSupportedError") return { state: "unsupported", message: "This browser could not start the camera in a supported format. Open this link in Safari or Chrome on a recent phone, or continue exploring in 3D." };
  return { state: "error", message: typeof fields.message === "string" ? fields.message : "AR could not start. Try Safari or Chrome on a recent phone, or return to the 3D viewer." };
}

async function startupError(error: unknown): Promise<{ state: State; message: string }> {
  // Some browsers reject denied getUserMedia with NotSupportedError. The actual
  // browser permission state is stronger evidence than the exception's name.
  try {
    if (navigator.permissions?.query) {
      const permission = await navigator.permissions.query({ name: "camera" as PermissionName });
      if (permission.state === "denied") return cameraError({ name: "NotAllowedError" });
    }
  } catch {
    // Camera permission queries are optional (including in Safari); use the error.
  }
  return cameraError(error);
}

/** The physical camera is controlled by tracking; gestures transform only the anchored model. */
export default function ArView({ project, selectedPoi, floor, onExit, onInterior }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const session = useRef<Session | null>(null);
  const generation = useRef(0);
  const stateRef = useRef<State>("idle");
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");
  const [activePoi, setActivePoi] = useState(selectedPoi || "");
  const [activeFloor, setActiveFloor] = useState(floor || "");
  const [showTarget, setShowTarget] = useState(false);
  const [source, setSource] = useState<"camera" | "photo">("camera");
  const [placement, setPlacement] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const poi = project.pois.find(item => item.id === activePoi);
  const busy = state === "initializing" || state === "requesting";

  function transition(next: State) { stateRef.current = next; setState(next); }
  function stop() { generation.current += 1; session.current?.release(); session.current = null; }
  useEffect(() => () => { generation.current += 1; session.current?.release(); session.current = null; }, []);
  useEffect(() => {
    if (session.current?.model) applyFloorVisibility(session.current.model, project.floors, activeFloor);
  }, [activeFloor, project.floors, state]);
  useEffect(() => {
    const marker = session.current?.focus;
    if (marker) { Object.assign(marker, { visible: !!poi }); if (poi) marker.position.fromArray(poi.position); }
  }, [poi, state]);

  function adjustScale(multiplier: number) {
    const current = session.current;
    if (!current?.transform) return;
    current.scale = THREE.MathUtils.clamp(current.scale * multiplier, project.ar.scale * .3, project.ar.scale * 3);
    current.transform.scale.setScalar(current.scale);
  }
  function reset() {
    const current = session.current;
    if (current?.transform) { current.scale = project.ar.scale; current.transform.scale.setScalar(current.scale); current.transform.rotation.y = 0; }
    setActivePoi(""); setActiveFloor("");
  }

  async function scanPhoto(file: File) {
    if (busy) return;
    stop(); const runId = generation.current;
    const abort = new AbortController();
    session.current = { release: () => abort.abort(), scale: project.ar.scale };
    setSource("photo"); setMessage(""); transition("initializing");
    try {
      const found = await recognizePhoto(file, project.ar.targetMindUrl, abort.signal, () => { if (generation.current === runId) transition("searching"); });
      if (generation.current !== runId) return;
      session.current = null;
      if (found) { transition("photo-verified"); setPlacement(true); }
      else { transition("photo-no-match"); setMessage("No matching target was found. Choose a photo showing the configured image clearly. The live camera opens after a successful scan."); }
    } catch (error) {
      if (generation.current !== runId || abort.signal.aborted) return;
      session.current = null; transition("error"); setMessage(error instanceof Error ? error.message : "This photo could not be scanned.");
    }
  }

  async function startCamera() {
    if (busy || !container.current) return;
    stop(); const runId = generation.current;
    const alive = () => generation.current === runId;
    setMessage("");
    setSource("camera");
    if (!window.isSecureContext) { transition("unsupported"); setMessage("Camera AR needs a secure connection. Open this site over HTTPS. A phone cannot use your computer’s localhost address; see the mobile testing guide."); return; }
    if (typeof WebGLRenderingContext === "undefined" || !navigator.mediaDevices?.getUserMedia) { transition("unsupported"); setMessage("This browser does not provide the camera and WebGL features AR needs. Try Safari or Chrome on a phone, or continue in 3D."); return; }
    transition("requesting");
    const host = container.current;
    let stream: MediaStream | undefined;
    let video: HTMLVideoElement | undefined;
    let input: HTMLVideoElement;
    let inputWidth = 0, inputHeight = 0;
    let renderer: THREE.WebGLRenderer | undefined;
    let model: THREE.Group | undefined;
    let controller: MindARController | undefined;
    let processing: Promise<void> | undefined;
    let targetUrl: string | undefined;
    let observer: ResizeObserver | undefined;
    let focus: THREE.Mesh | undefined;
    let removeGestures = () => {};
    let disposed = false;
    const release = () => {
      if (disposed) return; disposed = true;
      removeGestures(); observer?.disconnect();
      stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
      if (video) { video.pause(); video.srcObject = null; video.remove(); }
      if (controller) {
        controller.onUpdate = null; controller.stopProcessVideo();
        // Unblock an outstanding worker response before terminating its owner.
        controller.workerMatchDone?.({ targetIndex: -1, modelViewTransform: null });
        controller.workerTrackDone?.({ modelViewTransform: null });
        const finished = processing?.catch(() => {}) || Promise.resolve();
        void finished.finally(() => { controller?.dispose(); controller?.worker.terminate(); });
      }
      renderer?.setAnimationLoop(null); renderer?.dispose(); renderer?.forceContextLoss(); renderer?.domElement.remove();
      if (model) disposeObject(model);
      if (focus) { focus.geometry.dispose(); (focus.material as THREE.Material).dispose(); }
      if (targetUrl?.startsWith("blob:")) URL.revokeObjectURL(targetUrl);
    };
    session.current = { release, scale: project.ar.scale };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (!alive()) { release(); stream.getTracks().forEach(track => track.stop()); return; }
      video = document.createElement("video");
      video.autoplay = true; video.muted = true; video.playsInline = true; video.srcObject = stream;
      video.className = "ar-camera-video";
      host.appendChild(video);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("The camera did not provide video. Close other camera apps and try again.")), 15_000);
        video!.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
        video!.onerror = () => { clearTimeout(timer); reject(new Error("The camera video could not be started.")); };
      });
      await video.play();
      if (!alive()) { release(); return; }
      transition("initializing");
      video.width = video.videoWidth; video.height = video.videoHeight;
      input = video; inputWidth = video.videoWidth; inputHeight = video.videoHeight;
      const api = await loadTrackingLibrary();
      if (!alive()) { release(); return; }
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.setClearColor(0x000000, 0);
      renderer.domElement.className = "ar-render-canvas";
      renderer.domElement.setAttribute("aria-label", "Building anchored to the recognized image target");
      host.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x777568, 2.3));
      const light = new THREE.DirectionalLight(0xffffff, 2.5); light.position.set(0, 2000, 1000); scene.add(light);
      const camera = new THREE.PerspectiveCamera();
      const anchor = new THREE.Group(); anchor.matrixAutoUpdate = false; anchor.visible = false; scene.add(anchor);
      const orientation = new THREE.Group(); orientation.rotation.x = Math.PI / 2; anchor.add(orientation);
      const transform = new THREE.Group(); transform.scale.setScalar(project.ar.scale); orientation.add(transform);
      const postMatrix = new THREE.Matrix4();
      controller = new api.Controller({ inputWidth, inputHeight, maxTrack: 1, warmupTolerance: 5, missTolerance: 5,
        onUpdate: (update) => {
          if (!alive() || update.type !== "updateMatrix" || update.targetIndex !== 0) return;
          anchor.visible = update.worldMatrix !== null;
          if (update.worldMatrix) {
            anchor.matrix.fromArray(update.worldMatrix).multiply(postMatrix);
            if (stateRef.current !== "tracking") transition("tracking");
          }
          else if (stateRef.current === "tracking") transition("lost");
        }
      });
      controller.worker.onerror = () => { if (!alive()) return; setMessage("The image tracker stopped unexpectedly. Restart AR or return to the 3D viewer."); transition("error"); release(); };
      targetUrl = await resolveAssetUrl(project.ar.targetMindUrl);
      const [response] = await Promise.all([fetch(targetUrl), loadModel(project.model.url, renderer).then(loaded => {
        if (disposed || !alive()) disposeObject(loaded); else model = loaded;
      })]);
      if (!alive()) { if (targetUrl.startsWith("blob:")) URL.revokeObjectURL(targetUrl); return; }
      if (!model) throw new Error("The building model could not be initialized.");
      if (!response.ok) throw new Error("The compiled image target is missing. Open the editor and compile an image target, then publish again.");
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength === 0 || buffer.byteLength > 25 * 1024 * 1024) throw new Error("The compiled image target is empty or exceeds 25 MiB.");
      const result = controller.addImageTargetsFromBuffer(buffer);
      if (result.dimensions.length !== 1 || !result.dimensions[0].every(n => Number.isFinite(n) && n > 0)) throw new Error("Choose a .mind file containing exactly one valid target. Recompile the project image in the editor.");
      const [width, height] = result.dimensions[0];
      postMatrix.compose(new THREE.Vector3(width / 2, height / 2, 0), new THREE.Quaternion(), new THREE.Vector3(width, width, width));
      transform.add(model); applyFloorVisibility(model, project.floors, activeFloor);
      focus = new THREE.Mesh(new THREE.SphereGeometry(.2, 16, 12), new THREE.MeshBasicMaterial({ color: 0xe8b356, depthTest: false }));
      focus.renderOrder = 20; focus.visible = !!poi; if (poi) focus.position.fromArray(poi.position); transform.add(focus);
      session.current = { release, model, transform, focus, scale: project.ar.scale };
      const resize = () => {
        if (!renderer || !controller || !alive()) return;
        const cw = host.clientWidth, ch = host.clientHeight;
        if (!cw || !ch) return;
        const ratio = Math.max(cw / inputWidth, ch / inputHeight);
        const vw = inputWidth * ratio, vh = inputHeight * ratio;
        Object.assign(input.style, { width: `${vw}px`, height: `${vh}px`, left: `${(cw - vw) / 2}px`, top: `${(ch - vh) / 2}px` });
        const projection = controller.getProjectionMatrix();
        camera.fov = 2 * Math.atan(ch / vh / projection[5]) * 180 / Math.PI;
        camera.near = projection[14] / (projection[10] - 1); camera.far = projection[14] / (projection[10] + 1);
        camera.aspect = cw / ch; camera.updateProjectionMatrix(); renderer.setSize(cw, ch);
      };
      observer = new ResizeObserver(resize); observer.observe(host); resize();
      const pointers = new Map<number, { x: number; y: number }>();
      let lastDistance = 0;
      const distance = () => { const [a, b] = [...pointers.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; };
      const down = (event: PointerEvent) => { if ((event.target as HTMLElement).closest("button,a,select,input")) return; host.setPointerCapture(event.pointerId); pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); lastDistance = distance(); };
      const move = (event: PointerEvent) => {
        const old = pointers.get(event.pointerId); if (!old) return; event.preventDefault();
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.size === 1) transform.rotation.y += (event.clientX - old.x) * .01;
        else { const current = distance(); if (lastDistance > 0 && current > 0) adjustScale(current / lastDistance); lastDistance = current; }
      };
      const up = (event: PointerEvent) => { pointers.delete(event.pointerId); lastDistance = distance(); };
      const wheel = (event: WheelEvent) => { event.preventDefault(); adjustScale(Math.exp(-event.deltaY * .001)); };
      host.addEventListener("pointerdown", down); host.addEventListener("pointermove", move); host.addEventListener("pointerup", up); host.addEventListener("pointercancel", up); host.addEventListener("wheel", wheel, { passive: false });
      removeGestures = () => { host.removeEventListener("pointerdown", down); host.removeEventListener("pointermove", move); host.removeEventListener("pointerup", up); host.removeEventListener("pointercancel", up); host.removeEventListener("wheel", wheel); };
      stream?.getVideoTracks().forEach(track => { track.onended = () => { if (alive()) { setMessage("The camera stopped. Restart AR to continue."); transition("error"); release(); } }; });
      controller.dummyRun(input);
      if (!alive()) { release(); return; }
      transition("searching");
      renderer.setAnimationLoop(() => renderer?.render(scene, camera));
      processing = controller.processVideo(input);
      void processing.catch(error => { if (alive() && !disposed) { const detail = cameraError(error); setMessage(detail.message); transition(detail.state); release(); } });
    } catch (error) {
      release();
      const detail = await startupError(error);
      if (alive()) { transition(detail.state); setMessage(detail.message); }
    }
  }

  const status = { idle: "Choose how to begin", requesting: "Allow access to your camera", initializing: source === "photo" ? "Preparing your photo target" : "Preparing your experience", searching: source === "photo" ? "Scanning photo for the image target" : "Looking for your physical image target", tracking: "Image target recognized", lost: "Target lost — bring it back into view", "photo-verified": "Photo target verified", "photo-no-match": "No matching target found in this photo", denied: "Camera permission needed", unsupported: "Continue exploring in 3D", error: "Let’s try that again" }[state];
  const ready = ["idle", "denied", "unsupported", "error", "photo-no-match"].includes(state);
  const choosePhoto = () => photoInput.current?.click();
  if (placement) return <div className="photo-verified-placement" data-activation="photo-target"><FreePlacement project={project} onExit={onExit} onScanTarget={() => { setPlacement(false); setSource("camera"); setMessage(""); transition("idle"); }} onInterior={onInterior}/></div>;
  return <section className={"ar-view ar-state-" + state + " ar-source-" + source} aria-label="Image-target augmented reality">
    <input ref={photoInput} className="visually-hidden" type="file" accept="image/*" aria-label="Photo for target recognition" disabled={busy} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void scanPhoto(file); }}/>
    <div className="ar-camera-host" ref={container}/>
    <header className="ar-topbar"><button className="ar-glass-button" onClick={() => { stop(); onExit(); }}><ArrowLeft size={17}/>Back to 3D</button><span className="ar-wordmark">ATLAS <span>AR</span></span><button className="ar-glass-button ar-icon-only" aria-label="Show image target" onClick={() => setShowTarget(!showTarget)}><ScanLine size={20}/></button></header>
    {ready && <div className="ar-intro"><div className="ar-intro-icon"><ScanLine size={32}/></div><span className="ar-eyebrow">TWO WAYS TO EXPLORE</span><h1>{status}</h1><p>{message || "Scan a physical target to anchor the building to it. Or scan a photo from your library, then open the live camera and place the building in your space."}</p><div className="ar-target-peek"><AssetImage url={project.ar.targetImageUrl} alt="Configured project image target"/><span>Both routes recognize this project’s image target. Your photo activates camera placement; the physical print remains the anchor during image tracking.</span></div><div className="ar-entry-actions"><button className="button primary" onClick={() => void startCamera()}><Camera size={18}/>Start camera AR<ArrowRight size={17}/></button><button className="ar-glass-button ar-photo-button" onClick={choosePhoto}><ImagePlus size={18}/>Use a photo target</button></div><p className="ar-privacy">Images are checked locally. Camera access is requested after a photo matches.</p><button className="ar-text-button" onClick={() => { stop(); onExit(); }}>Explore without a camera</button></div>}
    {!ready && <>
      {source === "camera" && <div className="ar-source-actions"><button className="ar-glass-button" onClick={choosePhoto} disabled={busy}><ImagePlus size={15}/>Use a photo target</button></div>}
      <div className="ar-status" role="status">{state === "tracking" ? <Check size={16}/> : busy || source === "photo" ? <LoaderCircle size={16} className="spin"/> : <ScanLine size={16}/>}<span>{status}</span></div>
      {source === "photo" ? <div className="ar-photo-check"><ScanLine size={42}/><h2>Verifying your photo target</h2><p>The live camera opens after this image matches. You’ll place the building in your surroundings.</p></div> : <>
        {(state === "searching" || state === "lost") && <div className="ar-scan-guide" aria-hidden="true"><i/><i/><i/><i/></div>}
        <div className="ar-bottom"><div className="ar-instruction">{state === "tracking" ? "Image-anchored AR · Drag to rotate · Pinch to resize · Keep the target in view" : state === "lost" ? "The model is hidden until the physical target is recognized again." : "Hold steady, use good lighting, and keep the whole physical image visible."}</div>
          <div className="ar-tool-row"><button className="ar-glass-button ar-icon-only" aria-label="Make building smaller" onClick={() => adjustScale(.85)}><Minus size={19}/></button><button className="ar-glass-button" onClick={reset}><RotateCcw size={16}/>Reset</button><button className="ar-glass-button ar-icon-only" aria-label="Make building larger" onClick={() => adjustScale(1.15)}><Plus size={19}/></button>{project.floors.length > 0 && <label className="ar-floor-control"><Layers3 size={16}/><select aria-label="AR floor" value={activeFloor} onChange={e => setActiveFloor(e.target.value)}><option value="">All floors</option>{project.floors.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</div>
          {poi && <div className="ar-poi-details"><div><strong>{poi.name}</strong><p>{poi.description}</p></div>{poi.interior && project.interiorModel && onInterior && <button className="ar-glass-button" onClick={() => { stop(); onInterior(); }}>Step inside<ArrowRight size={16}/></button>}</div>}
          <div className="ar-poi-list" aria-label="Explore points of interest">{project.pois.map((item, index) => <button key={item.id} aria-pressed={item.id === activePoi} onClick={() => setActivePoi(item.id === activePoi ? "" : item.id)}><span>{String(index + 1).padStart(2, "0")}</span>{item.name}</button>)}</div>
        </div>
      </>}
    </>}
    {showTarget && <div className="ar-target-sheet"><button className="ar-glass-button ar-icon-only" aria-label="Close image target" onClick={() => setShowTarget(false)}><X size={20}/></button><h2>Your image target</h2><AssetImage url={project.ar.targetImageUrl} alt="The exact image to scan for this project"/><p>Scan this image through the live camera to anchor the building to it. Choose it from your library to verify the target and enter live camera placement.</p>{project.ar.targetImageUrl.startsWith("idb:") ? <p>Download the target from the 3D experience.</p> : <a href={project.ar.targetImageUrl} target="_blank" rel="noreferrer" className="ar-text-button">Open image in a new tab</a>}</div>}
  </section>;
}
