"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, Box, Camera, ChevronRight, Expand, ImageIcon, Layers3, MapPin, RotateCcw, ScanLine } from "lucide-react";
import { SAMPLE_PROJECT, type Project } from "@/lib/project";
import { decodeProjectHash } from "@/lib/publish";
import { parseProject } from "@/lib/validation";
import { getProject, getPublishedProject, resolveAssetUrl } from "@/lib/storage";
import { Brand, Modal, Notice, SceneLoading } from "./ui";
import AssetImage from "./asset-image";
const Viewer = dynamic(() => import("./viewer"), { ssr: false, loading: SceneLoading });
const ArView = dynamic(() => import("./ar-view"), { ssr: false });

async function readExperience(): Promise<{project:Project;preview:boolean}> {
  const shared = decodeProjectHash(window.location.hash);
  if (shared) return {project:shared,preview:false};
  const params = new URLSearchParams(window.location.search);
  const preview = params.get("preview");
  if (preview) { const draft = await getProject(preview); if (!draft) throw new Error("This preview is only available in the browser where it was created. Import the project backup or open a published link."); return {project:draft,preview:true}; }
  const id = params.get("project");
  if (!id) return {project:structuredClone(SAMPLE_PROJECT),preview:false};
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) throw new Error("This project URL has an invalid identifier.");
  const response = await fetch(`/projects/${id}/project.json`);
  if (response.ok) { const text = await response.text(); if (text.length > 256*1024) throw new Error("The project manifest exceeds the supported size."); return {project:parseProject(JSON.parse(text)),preview:false}; }
  const local = await getPublishedProject(id);
  if (local) return {project:local,preview:false};
  if (id === SAMPLE_PROJECT.id) return {project:structuredClone(SAMPLE_PROJECT),preview:false};
  throw new Error("This project has not been published on this website. Its author needs to export and host the project package. A browser-local project cannot be opened on another device.");
}

export default function Experience() {
  const [project,setProject]=useState<Project|null>(null);
  const [preview,setPreview]=useState(false);
  const [error,setError]=useState("");
  const [selected,setSelected]=useState<string|null>(null);
  const [floor,setFloor]=useState<string|null>(null);
  const [interior,setInterior]=useState(false);
  const [ar,setAr]=useState(false);
  const arDialog=useRef<HTMLDialogElement>(null);
  const [target,setTarget]=useState(false);
  const [message,setMessage]=useState("");
  useEffect(()=>{let active=true;let generation=0;const load=()=>{const current=++generation;readExperience().then(result=>{if(active&&current===generation){setProject(result.project);setPreview(result.preview);setError("");setSelected(null);setFloor(null);setInterior(false);setAr(false);}}).catch((e:Error)=>{if(active&&current===generation)setError(e.message);});};load();window.addEventListener("hashchange",load);window.addEventListener("popstate",load);return()=>{active=false;window.removeEventListener("hashchange",load);window.removeEventListener("popstate",load);};},[]);
  useEffect(()=>{if(ar&&!arDialog.current?.open)arDialog.current?.showModal();},[ar]);
  function overview(){setSelected(null);setFloor(null);setInterior(false);}
  async function downloadTarget(){if(!project)return;try{const url=await resolveAssetUrl(project.ar.targetImageUrl);const res=await fetch(url);if(!res.ok)throw new Error("The target image could not be downloaded.");const {downloadBlob}=await import("@/lib/publish");downloadBlob(await res.blob(),`${project.id}-target.png`);if(url.startsWith("blob:"))URL.revokeObjectURL(url);}catch(e){setMessage((e as Error).message);}}
  if(error)return <main className="center-page"><Brand/><ScanLine size={36}/><h1>This space isn’t available yet.</h1><p role="alert">{error}</p><Link className="button primary" href="/">Open workspace<ArrowRight size={16}/></Link></main>;
  if(!project)return <main className="center-page"><Brand/><p role="status">Opening a new perspective…</p></main>;
  const poi=project.pois.find(p=>p.id===selected);
  return <div className="experience-shell"><header className="experience-header"><Brand/><span className="experience-header-title">{project.name}<span>AN INTERACTIVE PERSPECTIVE</span></span><Link href={preview?`/editor/?project=${project.id}`:"/"} className="text-button"><ArrowLeft size={15}/>{preview?"Back to editor":"Studio"}</Link></header>{preview&&<div className="preview-banner">LOCAL PREVIEW<span>You’re exploring the latest saved draft.</span></div>}<main className="experience-main"><aside className="experience-info"><div className="page-eyebrow"><span className="olive-dot"/>{interior?"THE INTERIOR PERSPECTIVE":"A PLACE TO CALL HOME"}</div><span className="experience-number">{interior?"02":"01"} / THE EXPERIENCE</span><h1>{interior?"Step inside.":project.name}</h1><p className="experience-location"><MapPin size={14}/>{project.location}</p><p className="experience-story">{interior?"A closer look at the way spaces connect. Rotate the residence, find your favorite corner, and imagine the everyday.":project.description}</p><div className="experience-info-divider"/>{poi&&!interior?<div className="selected-poi-info"><span className="page-eyebrow">{poi.category.toUpperCase()}</span><h2>{poi.name}</h2><p>{poi.description}</p>{poi.mediaUrl&&<AssetImage url={poi.mediaUrl} alt={poi.name} className="poi-media"/>}{poi.interior&&project.interiorModel&&<button className="button primary full-width" onClick={()=>setInterior(true)}>Explore the interior<ArrowRight size={16}/></button>}</div>:<div className="explore-hint"><Box size={23}/><h3>{interior?"Space to make your own.":"Every detail has a story."}</h3><p>{interior?"This separate 3D interior lets you look around freely.":"Select a point on the building or explore the places below."}</p></div>}<button className="text-button overview-button" onClick={overview}><RotateCcw size={15}/>{interior?"Return to building":"Building overview"}</button><div className="experience-ar-card"><ScanLine size={22}/><h3>A different kind of open house.</h3><p>Bring the building into your real world.</p><button className="button primary full-width" onClick={()=>{setInterior(false);setAr(true);}}><Camera size={16}/>View in your space<ArrowUpRight size={15}/></button><button className="text-button" onClick={()=>setTarget(true)}><ImageIcon size={14}/>Get the image target</button></div></aside><section className={`experience-canvas ${project.cover}`} aria-label="Interactive architectural experience"><div className="experience-canvas-top"><span className="pill"><span className="olive-dot"/>{interior?"INTERIOR EXPLORER":"INTERACTIVE 3D"}</span><button className="icon-button fullscreen-button" aria-label="Toggle full screen" onClick={()=>{if(document.fullscreenElement)document.exitFullscreen().catch(()=>setMessage("Full screen is unavailable in this browser."));else document.querySelector(".experience-canvas")?.requestFullscreen?.().catch(()=>setMessage("Full screen is unavailable in this browser."));}}><Expand size={17}/></button></div><div className="experience-viewer">{!ar&&<Viewer project={project} selectedPoi={selected} floor={floor} interior={interior} onPoiSelect={id=>{setSelected(id);setInterior(false);}}/>}</div><div className="experience-canvas-bottom"><span className="interaction-help">Drag to rotate<span>·</span>Pinch or scroll to zoom</span>{!interior&&project.floors.length>0&&<label className="floor-select"><Layers3 size={15}/><select aria-label="Select a floor" value={floor||""} onChange={e=>setFloor(e.target.value||null)}><option value="">All floors</option>{project.floors.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}{interior&&<button className="button secondary" onClick={overview}><ArrowLeft size={15}/>Back to building</button>}</div><div className="poi-ribbon"><div className="poi-ribbon-label"><span>EXPLORE THE SPACES</span><small>{project.pois.length} perspectives to discover</small></div><div className="poi-ribbon-items">{project.pois.map((p,i)=><button key={p.id} aria-pressed={selected===p.id&&!interior} className={selected===p.id&&!interior?"active":""} onClick={()=>{setSelected(p.id);setInterior(false);}}><span>{String(i+1).padStart(2,"0")}</span><strong>{p.name}</strong><ChevronRight size={14}/></button>)}</div></div></section></main><footer className="experience-footer"><span>A new perspective, powered by Atlas AR.</span><span>3D works without a camera. AR requires a compatible browser & HTTPS.</span></footer>{ar&&<dialog ref={arDialog} className="ar-overlay" aria-label="Image-target AR experience" onCancel={()=>setAr(false)} style={{width:"100vw",height:"100dvh",maxWidth:"none",maxHeight:"none",margin:0,padding:0,border:0}}><ArView project={project} selectedPoi={selected} floor={floor} onExit={()=>setAr(false)} onInterior={()=>{setAr(false);setInterior(true);}}/></dialog>}<Modal open={target} onClose={()=>setTarget(false)} title="Your anchor to a new perspective"><p className="muted">Print this image or display it on a second screen. Open AR on your phone and keep the whole image in view.</p><div className="target-modal-image"><AssetImage url={project.ar.targetImageUrl} alt="Print this image for image-target AR"/></div><button className="button primary full-width" onClick={downloadTarget}><ArrowDownToLine size={16}/>Download target image</button><p className="small-print">This image anchors the model. A QR code separately opens the website.</p></Modal><Notice message={message} onClose={()=>setMessage("")}/></div>;
}
