"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Minus, Plus, RotateCcw, LoaderCircle, TriangleAlert } from "lucide-react";
import { applyFloorVisibility, disposeObject, loadModel } from "@/lib/scene";
import type { CameraView, Project, Vec3 } from "@/lib/project";

export type ViewerProps = {
  project: Project;
  selectedPoi?: string | null;
  floor?: string | null;
  interior?: boolean;
  onPoiSelect?: (id: string) => void;
  onReady?: () => void;
  onError?: (message: string) => void;
  captureRef?: RefObject<(() => CameraView) | null>;
};

type Flight = { from: THREE.Vector3; to: THREE.Vector3; targetFrom: THREE.Vector3; targetTo: THREE.Vector3; started: number };
type Engine = { scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; controls: OrbitControls; model: THREE.Group | null; flight: Flight | null; reducedMotion: boolean };
const INTERIOR_VIEW: CameraView = { position: [13, 12, 14], target: [0, 0.7, 0] };

// The shared spatial movement curve: cubic-bezier(.77,0,.175,1).
function spatialEase(progress: number): number {
  let low = 0, high = 1, t = progress;
  for (let i = 0; i < 10; i++) {
    t = (low + high) / 2;
    const x = 3 * (1 - t) ** 2 * t * 0.77 + 3 * (1 - t) * t ** 2 * 0.175 + t ** 3;
    if (x < progress) low = t; else high = t;
  }
  return 3 * (1 - t) * t ** 2 + t ** 3;
}

function moveCamera(engine: Engine, view: CameraView) {
  const to = new THREE.Vector3(...view.position), targetTo = new THREE.Vector3(...view.target);
  if (to.distanceTo(targetTo) < 0.5) to.add(new THREE.Vector3(3, 3, 3));
  if (engine.reducedMotion) {
    engine.camera.position.copy(to); engine.controls.target.copy(targetTo); engine.controls.update(); engine.flight = null;
  } else {
    engine.flight = { from: engine.camera.position.clone(), to, targetFrom: engine.controls.target.clone(), targetTo, started: performance.now() };
  }
}

export default function Viewer({ project, selectedPoi, floor, interior = false, onPoiSelect, onReady, onError, captureRef }: ViewerProps) {
  const container = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const markerRefs = useRef(new Map<string, HTMLButtonElement>());
  const latest = useRef({ project, selectedPoi, floor, interior });
  const callbacks = useRef({ onReady, onError });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const modelUrl = interior ? project.interiorModel?.url : project.model.url;

  useEffect(() => { latest.current = { project, selectedPoi, floor, interior }; }, [project, selectedPoi, floor, interior]);
  useEffect(() => { callbacks.current = { onReady, onError }; }, [onReady, onError]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let engine: Engine;
    let observer: ResizeObserver | undefined;
    let frame = 0;
    let active = true;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => { if (engine) engine.reducedMotion = motion.matches; };
    const contextLost = (event: Event) => {
      event.preventDefault();
      const message = "The graphics context was lost. Close other graphics-heavy tabs and reload the viewer.";
      setError(message); setStatus("error"); callbacks.current.onError?.(message);
    };
    try {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:none;outline:none;";
      renderer.domElement.setAttribute("aria-label", "Interactive 3D model. Drag to rotate, pinch or scroll to zoom.");
      renderer.domElement.addEventListener("webglcontextlost", contextLost);
      element.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 180);
      camera.position.set(17, 13, 19);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.dampingFactor = 0.09;
      controls.enablePan = false; controls.minDistance = 4; controls.maxDistance = 58;
      controls.minPolarAngle = 0.1; controls.maxPolarAngle = Math.PI * 0.48;
      controls.target.set(0, 3, 0); controls.update();
      engine = { scene, camera, renderer, controls, model: null, flight: null, reducedMotion: motion.matches };
      engineRef.current = engine;
      controls.addEventListener("start", () => { engine.flight = null; });
      scene.add(new THREE.HemisphereLight(0xf4f4e8, 0x7c8a7c, 2.4));
      const sun = new THREE.DirectionalLight(0xfff2d8, 3.2);
      sun.position.set(-8, 18, 10); sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.left = -15; sun.shadow.camera.right = 15;
      sun.shadow.camera.top = 15; sun.shadow.camera.bottom = -15;
      sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 60;
      sun.shadow.normalBias = 0.025; sun.shadow.bias = -0.0003; sun.shadow.radius = 4;
      scene.add(sun);
      const fill = new THREE.DirectionalLight(0xe6f0ef, 1.1); fill.position.set(12, 8, -10); scene.add(fill);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), new THREE.ShadowMaterial({ color: 0x5b6d5d, opacity: 0.14 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -0.015; ground.receiveShadow = true; scene.add(ground);
      const resize = () => {
        if (!active) return;
        const width = element.clientWidth, height = element.clientHeight;
        if (width < 1 || height < 1) return;
        renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
      };
      observer = new ResizeObserver(resize); observer.observe(element); resize();
      motion.addEventListener("change", updateMotion);
      const point = new THREE.Vector3();
      const animate = (now: number) => {
        if (!active) return;
        frame = requestAnimationFrame(animate);
        if (engine.flight) {
          const progress = Math.min((now - engine.flight.started) / 500, 1);
          const eased = progress >= 1 ? 1 : spatialEase(progress);
          camera.position.lerpVectors(engine.flight.from, engine.flight.to, eased);
          controls.target.lerpVectors(engine.flight.targetFrom, engine.flight.targetTo, eased);
          if (progress >= 1) engine.flight = null;
        }
        controls.update();
        renderer.render(scene, camera);
        const current = latest.current;
        for (const poi of current.project.pois) {
          const marker = markerRefs.current.get(poi.id);
          if (!marker) continue;
          point.set(...poi.position).project(camera);
          const visible = engine.model && !current.interior && point.z > -1 && point.z < 1 && Math.abs(point.x) < 1.05 && Math.abs(point.y) < 1.05;
          marker.style.visibility = visible ? "visible" : "hidden";
          marker.style.transform = `translate(${(point.x * 0.5 + 0.5) * element.clientWidth}px, ${(-point.y * 0.5 + 0.5) * element.clientHeight}px) translate(-50%, -50%)`;
        }
      };
      frame = requestAnimationFrame(animate);
    } catch {
      const message = "This browser could not start WebGL. Enable hardware acceleration or try a recent Chrome or Safari browser.";
      queueMicrotask(() => { if (active) { setError(message); setStatus("error"); callbacks.current.onError?.(message); } });
    }
    return () => {
      active = false; cancelAnimationFrame(frame); observer?.disconnect(); motion.removeEventListener("change", updateMotion);
      if (engineRef.current) {
        const current = engineRef.current;
        current.renderer.domElement.removeEventListener("webglcontextlost", contextLost);
        current.controls.dispose(); disposeObject(current.scene);
        current.scene.traverse((object) => { if (object instanceof THREE.DirectionalLight) object.shadow.dispose(); });
        current.renderer.dispose(); current.renderer.domElement.remove(); engineRef.current = null;
      }
    };
  }, [retry]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    let cancelled = false;
    const previous = engine.model;
    engine.model = null;
    if (previous) { engine.scene.remove(previous); disposeObject(previous); }
    if (!modelUrl) {
      const message = "This project does not have an interior model. Add one in the project editor.";
      queueMicrotask(() => { if (!cancelled) { setError(message); setStatus("error"); callbacks.current.onError?.(message); } });
      return () => { cancelled = true; };
    }
    queueMicrotask(() => { if (!cancelled) { setStatus("loading"); setError(""); } });
    loadModel(modelUrl, engine.renderer).then((model) => {
      if (cancelled) { disposeObject(model); return; }
      engine.model = model; engine.scene.add(model);
      const current = latest.current;
      if (!current.interior) applyFloorVisibility(model, current.project.floors, current.floor);
      const view = current.interior ? INTERIOR_VIEW : current.project.pois.find((poi) => poi.id === current.selectedPoi)?.camera ?? current.project.overview;
      engine.camera.position.set(...view.position); engine.controls.target.set(...view.target); engine.controls.update();
      setStatus("ready"); callbacks.current.onReady?.();
    }).catch((cause: unknown) => {
      if (cancelled) return;
      const message = cause instanceof Error ? cause.message : "The model could not be loaded.";
      setError(message); setStatus("error"); callbacks.current.onError?.(message);
    });
    return () => { cancelled = true; };
  }, [modelUrl, interior, retry]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine?.model) return;
    moveCamera(engine, interior ? INTERIOR_VIEW : project.pois.find((poi) => poi.id === selectedPoi)?.camera ?? project.overview);
  }, [selectedPoi, project.pois, project.overview, interior]);

  useEffect(() => {
    const engine = engineRef.current;
    if (engine?.model && !interior) applyFloorVisibility(engine.model, project.floors, floor);
  }, [floor, project.floors, interior]);

  useEffect(() => {
    if (!captureRef) return;
    captureRef.current = () => {
      const engine = engineRef.current;
      return engine ? { position: engine.camera.position.toArray() as Vec3, target: engine.controls.target.toArray() as Vec3 } : project.overview;
    };
    return () => { captureRef.current = null; };
  }, [captureRef, project.overview]);

  const zoom = (factor: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.flight = null;
    const offset = engine.camera.position.clone().sub(engine.controls.target).multiplyScalar(factor);
    offset.clampLength(engine.controls.minDistance, engine.controls.maxDistance);
    engine.camera.position.copy(engine.controls.target).add(offset); engine.controls.update();
  };

  return (
    <div className="model-viewer" style={{ position: "relative", width: "100%", height: "100%", minHeight: 280, overflow: "hidden" }}>
      <div ref={container} style={{ position: "absolute", inset: 0 }} />
      {!interior && project.pois.map((poi, index) => (
        <button key={poi.id} ref={(element) => { if (element) markerRefs.current.set(poi.id, element); else markerRefs.current.delete(poi.id); }}
          className={`poi-marker${selectedPoi === poi.id ? " is-selected" : ""}`} type="button" title={poi.name}
          aria-label={`Explore ${poi.name}`} aria-pressed={selectedPoi === poi.id} onClick={() => onPoiSelect?.(poi.id)}
          style={{ position: "absolute", top: 0, left: 0, visibility: "hidden", pointerEvents: status === "ready" ? "auto" : "none", zIndex: selectedPoi === poi.id ? 3 : 2 }}>
          <span>{String(index + 1).padStart(2, "0")}</span><span className="poi-marker-label">{poi.name}</span>
        </button>
      ))}
      <div className="viewer-tools" style={{ position: "absolute", right: 20, bottom: 20, display: "flex", gap: 5, zIndex: 4 }}>
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoom(0.82)}><Plus size={17} /></button>
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoom(1.22)}><Minus size={17} /></button>
        <button type="button" aria-label="Reset camera" title="Reset camera" onClick={() => { if (engineRef.current) moveCamera(engineRef.current, interior ? INTERIOR_VIEW : project.overview); }}><RotateCcw size={16} /></button>
      </div>
      {status === "loading" && <div className="viewer-status" role="status" style={{ position: "absolute", inset: 0, display: "grid", placeContent: "center", justifyItems: "center", gap: 12, zIndex: 5 }}><LoaderCircle size={23} className="spin" /><span>Preparing your perspective…</span></div>}
      {status === "error" && <div className="viewer-status viewer-error" role="alert" style={{ position: "absolute", inset: 0, display: "grid", placeContent: "center", justifyItems: "center", padding: 28, gap: 12, zIndex: 5 }}><TriangleAlert size={26} /><p style={{ maxWidth: 380, textAlign: "center" }}>{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>Try loading again</button></div>}
    </div>
  );
}
