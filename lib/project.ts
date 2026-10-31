import { createId } from "./id";
export type Vec3 = [number, number, number];
export type CameraView = { position: Vec3; target: Vec3 };
export type AssetRef = { url: string; name: string; size?: number };
export type Poi = {
  id: string;
  name: string;
  category: "amenity" | "apartment" | "entrance" | "outdoor";
  position: Vec3;
  camera: CameraView;
  description: string;
  mediaUrl?: string;
  interior?: boolean;
};
export type Floor = { id: string; name: string; nodeNames: string[] };
export type Project = {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  location: string;
  status: "draft" | "published";
  createdAt: string;
  updatedAt: string;
  model: AssetRef;
  interiorModel?: AssetRef;
  overview: CameraView;
  ar: { targetImageUrl: string; targetMindUrl: string; scale: number };
  pois: Poi[];
  floors: Floor[];
  cover: "sage" | "sand" | "slate";
};

export const DEFAULT_OVERVIEW: CameraView = { position: [17, 13, 19], target: [0, 3, 0] };

export const SAMPLE_PROJECT: Project = {
  schemaVersion: 1,
  id: "the-courtyard",
  name: "The Courtyard",
  description: "A quieter perspective on city living. Explore thoughtfully designed residences, open green spaces, and the places in between.",
  location: "Bengaluru, India",
  status: "published",
  createdAt: "2026-10-31T00:00:00.000Z",
  updatedAt: "2026-10-31T00:00:00.000Z",
  model: { url: "/assets/courtyard.glb", name: "Courtyard residences.glb" },
  interiorModel: { url: "/assets/interior.glb", name: "Two bedroom residence.glb" },
  overview: DEFAULT_OVERVIEW,
  ar: { targetImageUrl: "/assets/target.png", targetMindUrl: "/assets/target.mind", scale: 0.045 },
  pois: [
    { id: "entrance", name: "Main entrance", category: "entrance", position: [0, 0.7, 4], camera: { position: [7, 4, 11], target: [0, 1.2, 2] }, description: "A welcoming arrival, framed by natural stone and a generous landscaped forecourt." },
    { id: "pool", name: "Swimming pool", category: "amenity", position: [4, 0.6, 0], camera: { position: [12, 9, 9], target: [3, 0.5, 0] }, description: "An open-air pool and sun deck, tucked into the heart of the courtyard." },
    { id: "gym", name: "Fitness studio", category: "amenity", position: [-3, 1.2, 3], camera: { position: [-10, 5, 12], target: [-3, 1.2, 1] }, description: "Light-filled spaces for everyday movement, overlooking the garden." },
    { id: "rooftop", name: "Rooftop garden", category: "outdoor", position: [-2, 8, -2], camera: { position: [10, 15, 10], target: [-1, 6, -1] }, description: "A shared terrace above the city, with planted edges and room to unwind." },
    { id: "apartment", name: "Sample residence", category: "apartment", position: [-3, 4, 1], camera: { position: [-10, 6, 10], target: [-2, 4, 0] }, description: "Take a closer look at a two-bedroom residence. Open the separate interior model to explore its spaces.", interior: true },
  ],
  floors: Array.from({ length: 6 }, (_, i) => ({ id: `floor-${i}`, name: i === 0 ? "Ground floor" : `Level 0${i}`, nodeNames: [`floor_${i}`] })),
  cover: "sage",
};

export const SAMPLE_PROJECTS: Project[] = [
  SAMPLE_PROJECT,
  { ...structuredClone(SAMPLE_PROJECT), id: "terrace-house", name: "Terrace House", location: "Pune, India", status: "draft", cover: "sand", description: "Modern spaces. A little closer to nature." },
  { ...structuredClone(SAMPLE_PROJECT), id: "north-residences", name: "North Residences", location: "Mumbai, India", status: "draft", cover: "slate", description: "A new address, with a fresh point of view." },
];

export function createProject(name: string): Project {
  const now = new Date().toISOString();
  return { ...structuredClone(SAMPLE_PROJECT), id: `project-${createId().slice(0, 8)}`, name: name.trim(), status: "draft", createdAt: now, updatedAt: now };
}
