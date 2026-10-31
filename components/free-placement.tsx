"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { ArrowLeft, ArrowRight, Camera, Check, Layers3, LoaderCircle, Minus, Move, Plus, RotateCcw, RotateCw, ScanLine } from "lucide-react";
import type { Project } from "@/lib/project";
import { applyFloorVisibility, disposeObject, loadModel } from "@/lib/scene";
import { SurfaceTracker, type SurfaceState } from "@/lib/surface-placement";
import "./free-placement.css";

type Mode = "loading" | "manual" | "requesting-xr" | "xr-search" | "xr-placed" | "denied" | "unsupported" | "error";
type Status = { mode: Mode; message: string; surfaceReady: boolean; canRetry: boolean; surfaceProgress?: number; tracking?: "searching" | "tracking" | "lost" };
type Props = { project: Project; onExit: () => void; onScanTarget: () => void; onInterior?: () => void };
type Runtime = {
  start: () => void;
  release: () => void;
  startCamera: () => Promise<void>;
  startXR: () => void;
  useManual: () => void;
  place: () => void;
  setAutoPlace: (enabled: boolean) => void;
  reposition: () => void;
  rotate: (angle: number) => void;
  scale: (multiplier: number) => void;
  reset: () => void;
  floor: (id: string) => void;
  poi: (id: string) => void;
};

async function cameraFailure(error: unknown): Promise<Pick<Status, "mode" | "message">> {
  const info = typeof error === "object" && error !== null ? error as { name?: unknown; message?: unknown } : {};
  let denied = info.name === "NotAllowedError" || info.name === "PermissionDeniedError";
  try { denied ||= (await navigator.permissions?.query({ name: "camera" as PermissionName }))?.state === "denied"; }
  catch { /* Camera permission queries are not available in every browser. */ }
  if (denied) return { mode: "denied", message: "Allow camera access in this website’s browser permissions, then try again. If you opened an in-app browser, open this link in Safari or Chrome." };
  if (info.name === "NotFoundError" || info.name === "NotSupportedError") return { mode: "unsupported", message: "This browser could not start a compatible camera. Try Safari or Chrome on a phone, or return to the 3D experience." };
  return { mode: "error", message: typeof info.message === "string" ? info.message : "The camera could not start. Close other camera apps and try again." };
}

/** Imperative scene owner: the manual camera and native XR session never run together. */
function createRuntime(host: HTMLDivElement, overlay: HTMLDivElement, project: Project, changed: (status: Status) => void): Runtime {
  let disposed = false, fatal = false, modelReady = false, cameraReady = false, cameraEpoch = 0;
  let status: Status = { mode: "loading", message: "Opening the live camera and preparing the building…", surfaceReady: false, canRetry: false };
  const publish = (next: Partial<Status>) => { if (!disposed) { status = { ...status, ...next }; changed(status); } };
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = "fp-render-canvas";
  renderer.domElement.setAttribute("aria-label", "Building placement preview");
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x747b64, 2.2));
  const light = new THREE.DirectionalLight(0xffffff, 2.5); light.position.set(5, 14, 8); scene.add(light);
  const camera = new THREE.PerspectiveCamera(45, 1, .01, 500);
  const placement = new THREE.Group(); placement.visible = false;
  const content = new THREE.Group(); placement.add(content); scene.add(placement);
  const reticle = new THREE.Mesh(new THREE.RingGeometry(.11, .14, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xd8e7b3, side: THREE.DoubleSide }));
  reticle.matrixAutoUpdate = false; reticle.visible = false; scene.add(reticle);
  const focus = new THREE.Mesh(new THREE.SphereGeometry(.17, 16, 12), new THREE.MeshBasicMaterial({ color: 0xe8b356, depthTest: false }));
  focus.renderOrder = 20; focus.visible = false; content.add(focus);
  let model: THREE.Group | undefined;
  let video: HTMLVideoElement | undefined;
  let stream: MediaStream | undefined;
  let xrSession: XRSession | undefined;
  let hitSource: XRHitTestSource | undefined;
  let referenceSpace: XRReferenceSpace | undefined;
  let anchor: XRAnchor | undefined;
  let anchorEpoch = 0, xrEpoch = 0, placementRequested = false, autoPlace = true;
  const anchorOffset = new THREE.Matrix4();
  const surfaces = new SurfaceTracker();
  let placed = false, trackingLost = false, manualNotice = "";
  let userScale = 1, yaw = 0, screenX = .5, screenY = .48;
  const center = new THREE.Vector3(0, 3, 0);
  const bounds = new THREE.Sphere(center.clone(), 9);
  let distance = 30;
  const direction = new THREE.Vector3(...project.overview.position).sub(new THREE.Vector3(...project.overview.target)).normalize();
  if (direction.lengthSq() < .1) direction.set(.5, .35, .8).normalize();

  function updateTransform() {
    content.rotation.y = yaw;
    content.scale.setScalar(userScale * (xrSession ? .07 : 1));
    if (!xrSession) {
      camera.updateMatrixWorld();
      const viewHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      placement.position.copy(right.multiplyScalar((screenX - .5) * viewHeight * camera.aspect)).add(up.multiplyScalar((.5 - screenY) * viewHeight));
    }
  }
  function fitManualCamera() {
    if (xrSession) return;
    camera.aspect = Math.max(1, host.clientWidth) / Math.max(1, host.clientHeight);
    const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
    const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
    distance = bounds.radius / Math.sin(Math.min(vertical, horizontal)) * 1.22;
    camera.position.copy(center).addScaledVector(direction, distance);
    camera.lookAt(center); camera.updateProjectionMatrix(); updateTransform();
  }
  const resize = () => { if (disposed || renderer.xr.isPresenting) return; renderer.setSize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight)); fitManualCamera(); };
  const observer = new ResizeObserver(resize); observer.observe(host); resize();

  function stopCamera() {
    cameraEpoch += 1; cameraReady = false; placement.visible = false;
    stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); stream = undefined;
    if (video) { video.pause(); video.srcObject = null; video.remove(); video = undefined; }
  }
  function finishManual() {
    if (modelReady && cameraReady && !xrSession && !fatal) {
      placement.matrixAutoUpdate = true; placement.quaternion.identity(); placement.visible = true;
      fitManualCamera();
      publish({ mode: "manual", surfaceReady: false, canRetry: false, message: manualNotice });
    }
  }
  async function startCamera() {
    if (disposed || fatal || xrSession) return;
    stopCamera(); const epoch = cameraEpoch;
    if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) { publish({ mode: "unsupported", message: "Live camera placement needs HTTPS and a browser with camera access. Open a secure phone link, or return to 3D.", canRetry: false }); return; }
    publish({ mode: "loading", canRetry: false });
    let nextStream: MediaStream | undefined;
    try {
      nextStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (disposed || epoch !== cameraEpoch || xrSession) { nextStream.getTracks().forEach(track => track.stop()); return; }
      stream = nextStream;
      const element = document.createElement("video");
      element.className = "fp-camera-video"; element.autoplay = true; element.muted = true; element.playsInline = true; element.srcObject = stream;
      video = element; host.prepend(element);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("The live camera did not provide video. Close other camera apps and try again.")), 15_000);
        element.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
        element.onerror = () => { clearTimeout(timer); reject(new Error("The live camera video could not be played.")); };
      });
      await element.play();
      if (disposed || epoch !== cameraEpoch || xrSession) { nextStream.getTracks().forEach(track => track.stop()); element.remove(); return; }
      stream.getVideoTracks().forEach(track => { track.onended = () => { if (!disposed && !xrSession) { stopCamera(); publish({ mode: "error", message: "The camera stopped. Try opening it again.", canRetry: true }); } }; });
      cameraReady = true; finishManual();
    } catch (error) {
      nextStream?.getTracks().forEach(track => track.stop());
      const failure = await cameraFailure(error);
      if (!disposed && epoch === cameraEpoch) { stopCamera(); publish({ ...failure, canRetry: true }); }
    }
  }

  function clearAnchor() {
    anchorEpoch += 1;
    try { anchor?.delete(); } catch { /* A finished session may already have released the anchor. */ }
    anchor = undefined;
  }
  function resetSearch(message = "") {
    clearAnchor(); surfaces.reset(); placementRequested = false; placed = false;
    placement.visible = false; reticle.visible = false;
    publish({ mode: "xr-search", surfaceReady: false, surfaceProgress: 0, tracking: "searching", message });
  }
  const spaceReset = () => {
    surfaces.reset(); reticle.visible = false; placement.visible = false; placementRequested = false;
    if (!anchor) resetSearch("Tracking changed. Scan the floor or tabletop again to place the building safely.");
    else { trackingLost = true; publish({ surfaceReady: false, tracking: "lost", message: "Tracking paused. Hold your phone steady while the building’s anchor recovers." }); }
  };
  const visibilityChanged = () => {
    if (xrSession?.visibilityState !== "visible") {
      surfaces.reset(); placementRequested = false; placement.visible = false; reticle.visible = false; trackingLost = true;
      publish({ tracking: "lost", surfaceReady: false, surfaceProgress: 0, message: "Tracking paused. Return to the camera view and move slowly to recover." });
    }
  };
  function cancelHitSource() {
    clearAnchor(); surfaces.reset(); placementRequested = false;
    try { hitSource?.cancel(); } catch { /* Ending an XR session may already invalidate its source. */ }
    referenceSpace?.removeEventListener("reset", spaceReset);
    hitSource = undefined; referenceSpace = undefined;
  }
  function restoreManual(message = "") {
    if (disposed) return;
    xrEpoch += 1;
    xrSession = undefined; renderer.xr.enabled = false; reticle.visible = false; placement.visible = false; placed = false; trackingLost = false; manualNotice = message;
    placement.matrixAutoUpdate = true; placement.matrix.identity(); placement.position.set(0, 0, 0); placement.quaternion.identity(); placement.scale.setScalar(1);
    publish({ mode: "loading", surfaceReady: false, surfaceProgress: 0, tracking: "searching", message });
    updateTransform(); fitManualCamera(); void startCamera();
  }
  const ended = () => {
    xrEpoch += 1;
    xrSession?.removeEventListener("end", ended); xrSession?.removeEventListener("select", place); xrSession?.removeEventListener("visibilitychange", visibilityChanged);
    cancelHitSource(); if (!disposed) restoreManual("Surface placement ended. You’re back in the manual camera preview.");
  };
  function place() {
    if (!xrSession || placed || !status.surfaceReady) return;
    // A DOM click does not own an active XRFrame. Validate and use a fresh hit next frame.
    placementRequested = true;
  }
  function placeInFrame(hit: XRHitTestResult, hitMatrix: ArrayLike<number>) {
    if (!xrSession || placed) return;
    placementRequested = false;
    placement.matrix.copy(reticle.matrix); placement.matrixAutoUpdate = false; placement.visible = true;
    placed = true; reticle.visible = false;
    publish({ mode: "xr-placed", surfaceReady: false, surfaceProgress: 1, tracking: "tracking", message: "Building placed. Walk slowly to look around it." });
    const session = xrSession, epoch = ++anchorEpoch;
    if (!hit.createAnchor || (session.enabledFeatures && !session.enabledFeatures.includes("anchors"))) return;
    // Keep the averaged, upright placement relative to the native hit anchor.
    anchorOffset.copy(new THREE.Matrix4().fromArray(hitMatrix).invert()).multiply(placement.matrix);
    try {
      // Must be invoked synchronously while this hit's XRFrame is active.
      void hit.createAnchor().then(next => {
        if (disposed || xrSession !== session || epoch !== anchorEpoch || !placed) { next.delete(); return; }
        anchor = next;
      }).catch(() => {
        if (!disposed && xrSession === session && epoch === anchorEpoch) publish({ message: "Building placed using world tracking. If it shifts, choose Reposition and scan a textured surface." });
      });
    } catch { /* Anchors are optional; the native world-space placement remains usable. */ }
  }
  function startXR() {
    if (disposed || !modelReady || xrSession || !navigator.xr || status.mode === "requesting-xr") return;
    // requestSession must be called directly in the click's activation, before awaits.
    stopCamera(); placement.visible = false;
    publish({ mode: "requesting-xr", message: "Starting surface placement…", surfaceReady: false });
    const attempt = ++xrEpoch;
    let ownedSession: XRSession | undefined;
    let request: Promise<XRSession>;
    try { request = navigator.xr.requestSession("immersive-ar", { requiredFeatures: ["hit-test", "dom-overlay"], optionalFeatures: ["anchors"], domOverlay: { root: overlay } }); }
    catch (error) { restoreManual(error instanceof Error ? error.message : "Surface placement could not start. You can use manual placement."); return; }
    void request.then(async session => {
      ownedSession = session;
      if (disposed || attempt !== xrEpoch) { await session.end(); return; }
      xrSession = session; session.addEventListener("end", ended); session.addEventListener("select", place); session.addEventListener("visibilitychange", visibilityChanged);
      camera.position.set(0, 0, 0); camera.quaternion.identity(); camera.updateMatrixWorld();
      renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType("local");
      await renderer.xr.setSession(session);
      if (disposed || attempt !== xrEpoch || xrSession !== session) { await session.end(); return; }
      const local = renderer.xr.getReferenceSpace() || await session.requestReferenceSpace("local");
      if (disposed || attempt !== xrEpoch || xrSession !== session) { await session.end(); return; }
      referenceSpace = local;
      renderer.xr.setReferenceSpace(referenceSpace);
      referenceSpace.addEventListener("reset", spaceReset);
      const viewer = await session.requestReferenceSpace("viewer");
      if (disposed || attempt !== xrEpoch || xrSession !== session) { await session.end(); return; }
      if (!session.requestHitTestSource) throw new Error("This browser does not provide surface hit testing.");
      const source = await session.requestHitTestSource({ space: viewer, entityTypes: ["plane"] });
      if (!source) throw new Error("Surface hit testing could not start.");
      if (disposed || attempt !== xrEpoch || xrSession !== session) { source.cancel(); await session.end(); return; }
      hitSource = source; trackingLost = false; resetSearch(); updateTransform();
    }).catch(async error => {
      const failed = ownedSession;
      if (failed) { failed.removeEventListener("end", ended); failed.removeEventListener("select", place); failed.removeEventListener("visibilitychange", visibilityChanged); }
      if (disposed || attempt !== xrEpoch) { await failed?.end().catch(() => {}); return; }
      cancelHitSource(); xrSession = undefined;
      await failed?.end().catch(() => {});
      if (!disposed && attempt === xrEpoch) restoreManual(`Surface placement is unavailable: ${error instanceof Error ? error.message : "the browser could not start this mode"}. Manual preview is available instead.`);
    });
  }
  function useManual() {
    if (!xrSession) return;
    publish({ mode: "loading", message: "Returning to the live camera…" });
    const session = xrSession;
    void session.end().catch(() => { if (xrSession === session) { cancelHitSource(); restoreManual("The XR session ended. Manual camera preview is available."); } });
  }
  const suppressXRUi = (event: Event) => { if (event.target instanceof Element && event.target.closest("[data-placement-ui]")) event.preventDefault(); };
  overlay.addEventListener("beforexrselect", suppressXRUi);

  function searchMessage(surface: SurfaceState, elapsed: number) {
    if (surface.reason === "tilted") return "Aim down at a level floor or tabletop. Walls and steep surfaces cannot support the building.";
    if (surface.reason === "distance") return "Move closer to the surface, keeping it at least 25 cm from the camera.";
    if (surface.reason === "unstable") return "The surface estimate moved. Hold still briefly while it settles.";
    if (surface.phase === "stabilizing") return "Surface detected. Hold your phone steady for a moment…";
    if (surface.phase === "ready") return autoPlace ? "Surface is stable. Placing the building…" : "Surface is stable. Tap Place building to confirm.";
    return elapsed > 10_000 ? "Try a brighter, textured floor or tabletop. Avoid mirrors, glass and plain surfaces; move slowly side to side." : "Move slowly side to side and aim at a well-lit floor or tabletop.";
  }
  let searchStarted = 0;

  renderer.setAnimationLoop((time, frame) => {
    if (disposed) return;
    if (frame && xrSession && referenceSpace && hitSource) {
      const viewer = frame.getViewerPose(referenceSpace);
      if (!viewer || viewer.emulatedPosition || (xrSession.visibilityState && xrSession.visibilityState !== "visible")) {
        placement.visible = false; reticle.visible = false;
        surfaces.reset(); placementRequested = false;
        if (!trackingLost) { trackingLost = true; publish({ tracking: "lost", message: "Tracking paused. Move your phone slowly to recover the surface.", surfaceReady: false, surfaceProgress: 0 }); }
      } else {
        if (placed) {
          const anchorPose = anchor ? frame.getPose(anchor.anchorSpace, referenceSpace) : null;
          const pose = anchorPose && !anchorPose.emulatedPosition ? anchorPose : null;
          placement.visible = !anchor || !!pose;
          if (pose) placement.matrix.fromArray(pose.transform.matrix).multiply(anchorOffset);
          if (!placement.visible) {
            if (!trackingLost) { trackingLost = true; publish({ tracking: "lost", message: "Anchor tracking paused. Point back toward the building’s surface to recover it." }); }
          } else if (trackingLost) { trackingLost = false; publish({ tracking: "tracking", message: "Tracking recovered. The building is back on its surface." }); }
        } else {
          if (!searchStarted) searchStarted = time;
          trackingLost = false;
          const hits = frame.getHitTestResults(hitSource);
          const matrices = hits.map(hit => { const pose = hit.getPose(referenceSpace!); return pose && !pose.emulatedPosition ? pose.transform.matrix : null; });
          const surface = surfaces.update(matrices, viewer.transform.matrix, time);
          reticle.visible = !!surface.position;
          if (surface.position) {
            const position = new THREE.Vector3(...surface.position);
            const heading = Math.atan2(viewer.transform.position.x - position.x, viewer.transform.position.z - position.z);
            reticle.matrix.makeRotationY(heading).setPosition(position);
            (reticle.material as THREE.MeshBasicMaterial).color.setHex(surface.phase === "ready" ? 0xd8e7b3 : 0xe8b356);
          }
          const message = searchMessage(surface, time - searchStarted);
          const progress = Math.floor(surface.progress * 10) / 10;
          if (status.surfaceReady !== (surface.phase === "ready") || status.surfaceProgress !== progress || status.message !== message || status.tracking !== "searching") publish({ surfaceReady: surface.phase === "ready", surfaceProgress: progress, message, tracking: "searching" });
          if (surface.phase === "ready" && (autoPlace || placementRequested)) { placeInFrame(hits[surface.hitIndex], matrices[surface.hitIndex]!); searchStarted = 0; }
          else if (surface.phase !== "ready") placementRequested = false;
        }
      }
    }
    renderer.render(scene, camera);
  });

  const pointers = new Map<number, { x: number; y: number; startX: number; startY: number }>();
  let pinchDistance = 0;
  const span = () => { const [a, b] = [...pointers.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; };
  const scale = (multiplier: number) => { userScale = THREE.MathUtils.clamp(userScale * multiplier, .3, 2.5); updateTransform(); };
  const down = (event: PointerEvent) => { if (status.mode !== "manual") return; host.setPointerCapture(event.pointerId); pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY }); pinchDistance = span(); };
  const move = (event: PointerEvent) => {
    const old = pointers.get(event.pointerId); if (!old || status.mode !== "manual") return;
    event.preventDefault(); const dx = event.clientX - old.x, dy = event.clientY - old.y;
    pointers.set(event.pointerId, { ...old, x: event.clientX, y: event.clientY });
    if (pointers.size > 1) { const next = span(); if (pinchDistance > 0) scale(next / pinchDistance); pinchDistance = next; }
    else { screenX = THREE.MathUtils.clamp(screenX + dx / Math.max(1, host.clientWidth), .08, .92); screenY = THREE.MathUtils.clamp(screenY + dy / Math.max(1, host.clientHeight), .15, .82); updateTransform(); }
  };
  const up = (event: PointerEvent) => {
    const old = pointers.get(event.pointerId);
    if (old && pointers.size === 1 && Math.hypot(event.clientX - old.startX, event.clientY - old.startY) < 7 && status.mode === "manual") {
      const rect = host.getBoundingClientRect(); screenX = THREE.MathUtils.clamp((event.clientX - rect.left) / rect.width, .08, .92); screenY = THREE.MathUtils.clamp((event.clientY - rect.top) / rect.height, .15, .82); updateTransform();
    }
    pointers.delete(event.pointerId); pinchDistance = span();
  };
  const cancel = (event: PointerEvent) => { pointers.delete(event.pointerId); pinchDistance = span(); };
  const wheel = (event: WheelEvent) => { if (status.mode === "manual") { event.preventDefault(); scale(Math.exp(-event.deltaY * .001)); } };
  host.addEventListener("pointerdown", down); host.addEventListener("pointermove", move); host.addEventListener("pointerup", up); host.addEventListener("pointercancel", cancel); host.addEventListener("wheel", wheel, { passive: false });

  function release() {
    if (disposed) return; disposed = true; xrEpoch += 1;
    stopCamera(); observer.disconnect(); renderer.setAnimationLoop(null); cancelHitSource();
    overlay.removeEventListener("beforexrselect", suppressXRUi);
    host.removeEventListener("pointerdown", down); host.removeEventListener("pointermove", move); host.removeEventListener("pointerup", up); host.removeEventListener("pointercancel", cancel); host.removeEventListener("wheel", wheel);
    const session = xrSession; xrSession = undefined;
    const dispose = () => { renderer.xr.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); };
    if (session) { session.removeEventListener("end", ended); session.removeEventListener("select", place); session.removeEventListener("visibilitychange", visibilityChanged); void session.end().catch(() => {}).finally(dispose); } else dispose();
    if (model) disposeObject(model);
    reticle.geometry.dispose(); (reticle.material as THREE.Material).dispose(); focus.geometry.dispose(); (focus.material as THREE.Material).dispose();
  }
  return {
    start: () => {
      void startCamera();
      void loadModel(project.model.url, renderer).then(loaded => {
        if (disposed) { disposeObject(loaded); return; }
        model = loaded; content.add(model); const box = new THREE.Box3().setFromObject(model); box.getCenter(center); box.getBoundingSphere(bounds);
        modelReady = true; fitManualCamera(); finishManual();
      }).catch(error => { if (!disposed) { fatal = true; stopCamera(); placement.visible = false; publish({ mode: "error", message: error instanceof Error ? error.message : "The building could not be loaded.", canRetry: false }); } });
    },
    release, startCamera, startXR, useManual, place,
    setAutoPlace: enabled => { autoPlace = enabled; placementRequested = false; },
    reposition: () => { if (xrSession) { searchStarted = 0; resetSearch(); } },
    rotate: angle => { yaw += angle; updateTransform(); }, scale,
    reset: () => { userScale = 1; yaw = 0; screenX = .5; screenY = .48; if (xrSession) { searchStarted = 0; resetSearch(); } updateTransform(); },
    floor: id => { if (model) applyFloorVisibility(model, project.floors, id); },
    poi: id => { const item = project.pois.find(p => p.id === id); focus.visible = !!item; if (item) focus.position.fromArray(item.position); },
  };
}

export default function FreePlacement({ project, onExit, onScanTarget, onInterior }: Props) {
  const host = useRef<HTMLDivElement>(null), overlay = useRef<HTMLDivElement>(null), runtime = useRef<Runtime | null>(null);
  const [status, setStatus] = useState<Status>({ mode: "loading", message: "Opening the live camera and preparing the building…", surfaceReady: false, canRetry: false });
  const [supportsXR, setSupportsXR] = useState(false);
  const [autoPlace, setAutoPlace] = useState(true);
  const [floor, setFloor] = useState("");
  const [selected, setSelected] = useState("");
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active || !host.current || !overlay.current) return;
      runtime.current = createRuntime(host.current, overlay.current, project, next => { if (active) setStatus(next); });
      runtime.current.start();
    }).catch(error => { if (active) setStatus({ mode: "error", message: error instanceof Error ? error.message : "This browser could not initialize 3D placement.", surfaceReady: false, canRetry: false }); });
    if (navigator.xr && isSecureContext) void navigator.xr.isSessionSupported("immersive-ar").then(value => { if (active) setSupportsXR(value); }).catch(() => { if (active) setSupportsXR(false); });
    return () => { active = false; runtime.current?.release(); runtime.current = null; };
  }, [project]);
  const native = status.mode === "xr-search" || status.mode === "xr-placed";
  const busy = status.mode === "loading" || status.mode === "requesting-xr";
  const failure = ["denied", "unsupported", "error"].includes(status.mode);
  const poi = project.pois.find(item => item.id === selected);
  function leave(callback: () => void) { runtime.current?.release(); callback(); }
  function reset() { runtime.current?.reset(); runtime.current?.floor(""); runtime.current?.poi(""); setFloor(""); setSelected(""); }
  const title = native && status.tracking === "lost" ? "Tracking paused — move slowly" : status.mode === "manual" ? "Manual camera preview" : status.mode === "xr-placed" ? "Placed on a real surface" : status.mode === "xr-search" ? status.surfaceReady ? "Surface found — ready to place" : status.surfaceProgress ? "Surface detected — hold steady" : "Looking for a floor or tabletop" : status.mode === "denied" ? "Camera permission needed" : status.mode === "unsupported" ? "Camera placement unavailable" : status.mode === "error" ? "Placement could not start" : status.mode === "requesting-xr" ? "Starting surface placement" : "Opening your live camera";
  return <section className="free-placement" data-mode={status.mode} data-tracking={status.tracking} aria-label="Live camera building placement">
    <div className="fp-camera-host" ref={host}/>
    <div className="fp-overlay" ref={overlay}>
      <header className="fp-header" data-placement-ui><button className="fp-button" onClick={() => leave(onExit)}><ArrowLeft size={16}/>Back to 3D</button><span>FREE PLACEMENT</span><button className="fp-button" onClick={() => leave(onScanTarget)}><ScanLine size={16}/>Scan physical target</button></header>
      <div className="fp-status" role="status">{busy ? <LoaderCircle size={16} className="fp-spin"/> : native && status.tracking !== "lost" && status.mode === "xr-placed" ? <Check size={16}/> : native ? <ScanLine size={16}/> : <Camera size={16}/>}<span>{title}</span></div>
      {status.mode === "manual" && <div className="fp-mode-note">Screen-relative placement. This mode does not track surfaces or keep the building fixed as you move.{!supportsXR && " Surface tracking is unavailable in this browser. Scan the physical target for image-anchored AR."}</div>}
      {status.mode === "xr-search" && <div className="fp-scan-guide" aria-hidden="true"><span/><i/><span/></div>}
      {(busy || failure) && <div className="fp-state-panel" data-placement-ui><Camera size={30}/><h1>{title}</h1><p>{status.message}</p>{status.canRetry && <button className="fp-button fp-primary" onClick={() => { void runtime.current?.startCamera(); }}>Try camera again</button>}{failure && <button className="fp-button" onClick={() => leave(onExit)}>Explore without a camera<ArrowRight size={16}/></button>}</div>}
      {!busy && !failure && <div className="fp-bottom" data-placement-ui>
        {status.message && <p className="fp-message">{status.message}</p>}
        {status.mode === "manual" && supportsXR && <div className="fp-surface-offer"><div><strong>Place it in your room.</strong><span>Your browser offers surface tracking. Tap to start native AR.</span></div><button className="fp-button fp-primary" onClick={() => runtime.current?.startXR()}><Move size={16}/>Place on a surface</button></div>}
        {(native && status.mode === "xr-search" || status.mode === "manual" && supportsXR) && <label className="fp-auto-place"><input type="checkbox" checked={autoPlace} onChange={event => { setAutoPlace(event.target.checked); runtime.current?.setAutoPlace(event.target.checked); }}/>Auto-place on a stable surface</label>}
        {native && <div className="fp-native-controls">{status.mode === "xr-search" && <div className="fp-surface-progress" role="progressbar" aria-label="Surface stability" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((status.surfaceProgress || 0) * 100)}><span style={{ width: `${(status.surfaceProgress || 0) * 100}%` }}/></div>}<p>{status.mode === "xr-search" ? autoPlace ? "Aim the center of the screen at the surface. Hold steady and the building will appear automatically." : "Aim the center of the screen at the surface. Hold steady, then confirm placement." : "The building is placed in your room. Use Reposition to choose a different surface."}</p>{status.mode === "xr-search" ? <button className="fp-button fp-primary" disabled={!status.surfaceReady} onClick={() => runtime.current?.place()}><Check size={16}/>Place building</button> : <button className="fp-button fp-primary" onClick={() => runtime.current?.reposition()}><Move size={16}/>Reposition</button>}<button className="fp-button" onClick={() => runtime.current?.useManual()}>Use manual preview</button></div>}
        {status.mode !== "xr-search" && <><p className="fp-gesture-help">{native ? "Use the controls to rotate or resize." : "Tap or drag to position · Pinch to resize"}</p>
        <div className="fp-tools"><button className="fp-button fp-icon" aria-label="Rotate left" onClick={() => runtime.current?.rotate(Math.PI / 12)}><RotateCcw size={18}/></button><button className="fp-button fp-icon" aria-label="Rotate right" onClick={() => runtime.current?.rotate(-Math.PI / 12)}><RotateCw size={18}/></button><button className="fp-button fp-icon" aria-label="Make building smaller" onClick={() => runtime.current?.scale(.85)}><Minus size={18}/></button><button className="fp-button fp-icon" aria-label="Make building larger" onClick={() => runtime.current?.scale(1.15)}><Plus size={18}/></button><button className="fp-button" onClick={reset}>Reset placement</button>{project.floors.length > 0 && <label className="fp-floor"><Layers3 size={16}/><select aria-label="Placement floor" value={floor} onChange={event => { setFloor(event.target.value); runtime.current?.floor(event.target.value); }}><option value="">All floors</option>{project.floors.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</div>
        {poi && <div className="fp-poi-details"><div><strong>{poi.name}</strong><p>{poi.description}</p></div>{poi.interior && project.interiorModel && onInterior && <button className="fp-button" onClick={() => leave(onInterior)}>Step inside<ArrowRight size={16}/></button>}</div>}
        <div className="fp-pois" aria-label="Placement points of interest">{project.pois.map((item, index) => <button key={item.id} aria-pressed={selected === item.id} onClick={() => { const next = selected === item.id ? "" : item.id; setSelected(next); runtime.current?.poi(next); }}><span>{String(index + 1).padStart(2, "0")}</span>{item.name}</button>)}</div></>}
      </div>}
    </div>
  </section>;
}
