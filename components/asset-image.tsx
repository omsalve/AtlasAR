"use client";
import { useEffect, useState } from "react";
import { resolveAssetUrl } from "@/lib/storage";
export default function AssetImage({ url, alt, className }: { url: string; alt: string; className?: string }) {
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { let active = true; let resolved = ""; resolveAssetUrl(url).then(value => { resolved = value; if (active) { setSource(value); setError(""); } else if (value.startsWith("blob:")) URL.revokeObjectURL(value); }).catch((e: Error) => { if (active) setError(e.message); }); return () => { active = false; if (resolved.startsWith("blob:")) URL.revokeObjectURL(resolved); }; }, [url]);
  return error ? <p className="inline-error">{error}</p> : source ? <img src={source} alt={alt} className={className}/> : <span className="muted">Loading image…</span>;
}
