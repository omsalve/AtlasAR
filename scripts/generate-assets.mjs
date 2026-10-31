/** Original Atlas AR sample models. No external artwork or textures. MIT licensed. */
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import assert from "node:assert/strict";

globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => { this.result = result; this.onloadend?.(); });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = `data:${blob.type};base64,${Buffer.from(result).toString("base64")}`;
      this.onloadend?.();
    });
  }
};

const materials = {};
const mat = (color, roughness = 0.8, metalness = 0) => {
  const key = `${color}-${roughness}-${metalness}`;
  return materials[key] ??= new THREE.MeshStandardMaterial({ color, roughness, metalness });
};
const stone = mat("#e7e0d0"), white = mat("#f2eee3"), concrete = mat("#bebcaf");
const glass = mat("#547d79", 0.28, 0.2), frame = mat("#3a4943"), wood = mat("#a38462");
const grass = mat("#788b65"), leaf = mat("#496b50"), darkLeaf = mat("#3d5d44");
const water = mat("#76a9ad", 0.15, 0.25), paving = mat("#d4d1c1"), charcoal = mat("#68716a");
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitSphere = new THREE.IcosahedronGeometry(1, 1);
const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 10);

function box(parent, material, x, y, z, w, h, d, name = "") {
  const mesh = new THREE.Mesh(unitBox, material);
  mesh.position.set(x, y, z); mesh.scale.set(w, h, d); mesh.name = name;
  parent.add(mesh); return mesh;
}
function cylinder(parent, material, x, y, z, r, h) {
  const mesh = new THREE.Mesh(unitCylinder, material);
  mesh.position.set(x, y, z); mesh.scale.set(r, h, r); parent.add(mesh); return mesh;
}
function tree(parent, x, z, size = 1, y = 0.2) {
  cylinder(parent, wood, x, y + size * 0.38, z, 0.065 * size, size * 0.76);
  for (let i = 0; i < 3; i++) {
    const mesh = new THREE.Mesh(unitSphere, i === 1 ? darkLeaf : leaf);
    mesh.position.set(x + (i - 1) * 0.17 * size, y + size * (1.0 + i * 0.1), z + (i === 1 ? 0.1 : -0.08));
    mesh.scale.set(size * 0.45, size * 0.52, size * 0.45); parent.add(mesh);
  }
}
function planter(parent, x, y, z, w, d) {
  box(parent, stone, x, y + 0.13, z, w, 0.26, d);
  box(parent, grass, x, y + 0.28, z, w - 0.08, 0.1, d - 0.08);
  const count = Math.max(1, Math.floor(w / 0.3));
  for (let i = 0; i < count; i++) {
    const shrub = new THREE.Mesh(unitSphere, leaf);
    shrub.position.set(x - w / 2 + (i + 0.5) * w / count, y + 0.4, z);
    shrub.scale.set(0.22, 0.18, Math.min(d * 0.6, 0.28)); parent.add(shrub);
  }
}
function balconyFront(parent, x, y, z, width, depth = 0.5) {
  box(parent, white, x, y, z + depth / 2, width, 0.11, depth);
  box(parent, glass, x, y + 0.26, z + depth - 0.035, width, 0.38, 0.035);
  box(parent, frame, x, y + 0.48, z + depth - 0.035, width, 0.035, 0.035);
  for (const sign of [-1, 1]) box(parent, frame, x + sign * (width / 2 - 0.025), y + 0.25, z + depth - 0.035, 0.035, 0.46, 0.035);
}

function building() {
  const root = new THREE.Group(); root.name = "Courtyard_Residences";
  root.userData = { author: "Atlas AR", license: "MIT", units: "meters", convention: "floor_0 through floor_5; Y-up" };
  const landscape = new THREE.Group(); landscape.name = "landscape"; root.add(landscape);
  box(landscape, concrete, 0, -0.1, 0, 12, 0.2, 10.5, "site_base");
  box(landscape, paving, 0, 0.035, 0, 11.8, 0.07, 10.3);
  box(landscape, grass, 0.25, 0.11, 1.1, 3.6, 0.12, 4.6, "courtyard_garden");
  box(landscape, white, 3.6, 0.14, 0.7, 3.45, 0.16, 4.9, "pool_coping");
  box(landscape, water, 3.6, 0.235, 0.7, 2.95, 0.08, 4.35, "swimming_pool");
  for (let i = 0; i < 7; i++) box(landscape, mat("#8ab5b5", 0.2), 3.6, 0.281, -1.1 + i * 0.58, 2.84, 0.004, 0.035);
  for (let i = 0; i < 4; i++) {
    box(landscape, wood, 5.55, 0.31, -0.9 + i * 1.03, 0.48, 0.13, 0.8);
    box(landscape, white, 5.55, 0.4, -0.9 + i * 1.03, 0.42, 0.1, 0.64);
  }
  box(landscape, white, 0, 0.16, 4.15, 2.3, 0.18, 1.6, "arrival_path");
  for (let i = 0; i < 5; i++) box(landscape, concrete, 0.15, 0.21, 1.1 + i * 0.5, 1.0, 0.09, 0.32);
  for (const [x,z,s] of [[-5.3,4.25,1.05],[-2.3,4.35,0.85],[1.6,4.5,0.9],[5.35,-4.25,1],[-5.25,-4.3,0.9],[0.9,2.5,0.75],[1.0,-0.9,0.75]]) tree(landscape,x,z,s);
  planter(landscape, -4.1, 0.1, 4.4, 1.1, 0.5); planter(landscape, 4.0, 0.1, 4.65, 2.2, 0.55);
  for (const z of [-3,-1.7,-0.4,0.9,2.2]) planter(landscape,-5.55,0.12,z,0.55,0.9);

  // Six named floors. Every part that disappears with a floor lives beneath its group.
  for (let floor = 0; floor < 6; floor++) {
    const group = new THREE.Group(); group.name = `floor_${floor}`; root.add(group);
    const y = 0.23 + floor * 1.27;
    // Rear bar and a perpendicular wing form a generous open courtyard.
    box(group, white, -0.9, y, -3.15, 8.6, 0.15, 3.35, "rear_slab");
    box(group, stone, -0.9, y + 0.63, -3.3, 8.4, 1.12, 2.8);
    box(group, white, -3.7, y, 0.35, 3.05, 0.15, 4.0, "wing_slab");
    box(group, stone, -3.7, y + 0.63, 0.2, 2.8, 1.12, 3.65);
    // Front glazing and balcony bays on the rear bar.
    for (let bay = 0; bay < 6; bay++) {
      const x = -4.37 + bay * 1.36;
      box(group, glass, x, y + 0.59, -1.885, 1.08, 0.88, 0.045);
      box(group, frame, x, y + 0.59, -1.852, 0.035, 0.9, 0.035);
      box(group, white, x - 0.59, y + 0.62, -1.83, 0.1, 1.1, 0.11);
      balconyFront(group, x, y + 0.08, -1.86, 1.3, 0.54);
      if ((bay + floor) % 3 === 0) planter(group, x + 0.22, y + 0.12, -1.48, 0.58, 0.18);
      // Recessed rear windows are also visible when orbiting.
      box(group, glass, x, y + 0.6, -4.715, 0.94, 0.8, 0.035);
      box(group, frame, x, y + 0.6, -4.74, 0.035, 0.83, 0.035);
    }
    // Courtyard-facing wing has continuous glazing and slender timber screens.
    for (let bay = 0; bay < 3; bay++) {
      const z = -0.95 + bay * 1.28;
      box(group, glass, -2.285, y + 0.59, z, 0.035, 0.88, 1.04);
      box(group, white, -2.23, y + 0.63, z - 0.59, 0.12, 1.14, 0.1);
      box(group, white, -1.99, y + 0.08, z, 0.53, 0.1, 1.26);
      box(group, glass, -1.745, y + 0.32, z, 0.035, 0.4, 1.2);
      box(group, frame, -1.745, y + 0.54, z, 0.035, 0.035, 1.22);
      box(group, glass, -5.12, y + 0.59, z, 0.035, 0.79, 0.9);
    }
    // Front end of wing; main ground-floor fitness studio is legible from arrival.
    box(group, glass, -3.7, y + 0.61, 2.045, 2.45, 0.91, 0.04, floor === 0 ? "fitness_studio" : "wing_front_window");
    for (let slat = 0; slat < 9; slat++) box(group, wood, -4.88 + slat * 0.29, y + 0.66, 2.1, 0.055, 1.1, 0.12);
    // End wall vertical articulation and thin floor fascia.
    box(group, white, 3.36, y + 0.61, -3.3, 0.12, 1.14, 2.9);
    box(group, glass, 3.43, y + 0.6, -3.25, 0.035, 0.86, 1.95);
    box(group, white, -0.9, y + 1.23, -3.15, 8.68, 0.09, 3.4);
    box(group, white, -3.7, y + 1.23, 0.35, 3.1, 0.09, 4.05);

    if (floor === 0) {
      box(group, wood, -0.4, y + 1.05, -0.75, 2.2, 0.15, 1.9, "entry_canopy");
      box(group, frame, -1.4, y + 0.55, 0.12, 0.07, 1.05, 0.07);
      box(group, frame, 0.6, y + 0.55, 0.12, 0.07, 1.05, 0.07);
    }
    if (floor === 5) {
      const roofY = y + 1.3;
      for (let i=0;i<6;i++) planter(group,-4.2+i*1.28,roofY,-4.47,1.1,0.4);
      planter(group,-4.95,roofY,-0.1,0.35,3.3);
      box(group, wood, -1.7, roofY + 0.04, -2.65, 3.1, 0.08, 1.8, "rooftop_deck");
      for (const x of [-3.1,-0.3]) for (const z of [-3.4,-1.9]) box(group, wood,x,roofY+0.65,z,0.07,1.3,0.07);
      for (let i=0;i<10;i++) box(group,wood,-3.15+i*0.32,roofY+1.3,-2.65,0.1,0.09,1.9);
      tree(group,1.7,-3.2,0.7,roofY);
    }
  }
  return root;
}

function interior() {
  const root = new THREE.Group(); root.name = "Courtyard_Two_Bedroom_Interior";
  root.userData = { author: "Atlas AR", license: "MIT", units: "meters", description: "Open dollhouse interior, ceiling and front walls omitted for inspection." };
  const oak = mat("#c1a381"), fabric = mat("#b9b5a3"), linen = mat("#e6dfce"), rug = mat("#929d8a");
  box(root, white, 0, 0, 0, 11.9, 0.22, 8.3, "interior_base");
  box(root, oak, 0, 0.14, 0, 11.65, 0.06, 8.05, "oak_floor");
  for (let i=0;i<28;i++) box(root,mat("#b29878"),0,0.174,-3.9+i*0.29,11.6,0.003,0.012);
  // Back and side walls stay low/open so mobile orbit inspection is useful.
  box(root,stone,0,1.45,-4.06,11.8,2.7,0.14,"rear_wall");
  box(root,white,-5.82,1.25,0,0.15,2.3,8.1,"left_wall");
  box(root,white,5.82,0.7,0,0.15,1.2,8.1,"right_cutaway_wall");
  box(root,white,0.7,1.05,-1.2,0.14,1.8,5.5,"bedroom_partition");
  box(root,white,3.3,0.9,0.1,5.0,1.5,0.13,"bedroom_divider");
  for(const x of [-3.6,-1.3,2.2,4.3]) {
    box(root,glass,x,1.5,-3.965,1.6,1.65,0.03);
    box(root,frame,x,1.5,-3.94,0.04,1.7,0.04);
    box(root,frame,x,0.65,-3.94,1.66,0.04,0.04);
  }
  // Living room sofa, accent chair, rug, low table, media cabinet.
  box(root,rug,-3.0,0.19,1.45,4.3,0.04,3.4,"living_rug");
  box(root,fabric,-4.5,0.49,1.35,1.2,0.58,2.9,"sofa");
  box(root,fabric,-4.98,0.89,1.35,0.25,0.65,3.05);
  for(const z of [0.1,2.6]) box(root,fabric,-4.48,0.73,z,1.22,0.47,0.22);
  for(let i=0;i<3;i++) box(root,linen,-4.3,0.82,0.45+i*0.85,0.8,0.16,0.77);
  box(root,oak,-2.6,0.48,1.4,1.55,0.13,1.1,"coffee_table");
  for(const x of [-3.15,-2.05]) for(const z of [1.05,1.75]) box(root,frame,x,0.32,z,0.045,0.3,0.045);
  box(root,stone,-2.6,0.58,1.4,0.45,0.07,0.3);
  box(root,oak,0.0,0.4,1.4,0.5,0.45,2.5,"media_unit");
  box(root,frame,0.08,1.1,1.4,0.07,0.88,1.6,"television");
  box(root,mat("#4f6657"),-2.0,0.55,3.0,1.0,0.72,0.9,"accent_chair");
  box(root,mat("#4f6657"),-2.0,0.94,3.4,1.0,0.6,0.16);
  tree(root,-5.25,3.2,0.8,0.15);
  // Kitchen and dining behind living room.
  box(root,white,-3.9,0.64,-3.25,3.3,0.94,1.0,"kitchen_cabinet");
  box(root,stone,-3.9,1.14,-3.25,3.4,0.09,1.07);
  box(root,charcoal,-4.8,1.195,-3.25,0.64,0.025,0.6,"hob");
  cylinder(root,frame,-4.8,1.22,-3.25,0.16,0.04);
  box(root,concrete,-2.6,1.19,-3.25,0.6,0.02,0.62,"sink");
  box(root,white,-5.2,1.8,-3.7,0.65,1.3,0.5,"tall_cabinet");
  box(root,oak,-2.75,0.78,-1.25,2.4,0.12,1.3,"dining_table");
  for(const x of [-3.6,-1.9]) for(const z of [-1.7,-0.8]) box(root,wood,x,0.46,z,0.08,0.63,0.08);
  for(const x of [-3.5,-2.0]) for(const z of [-2.2,-0.3]) {
    box(root,fabric,x,0.55,z,0.57,0.13,0.57);
    box(root,wood,x,0.86,z+(z< -1?-0.26:0.26),0.58,0.6,0.06);
    for(const dx of [-0.21,0.21]) for(const dz of [-0.21,0.21]) box(root,wood,x+dx,0.32,z+dz,0.035,0.36,0.035);
  }
  // Two bedrooms with bedding, pillows, wardrobe and nightstands.
  for(const z of [-2.1,2.1]) {
    box(root,oak,3.0,0.4,z,2.3,0.45,2.8,"bed_frame");
    box(root,linen,3.0,0.7,z,2.2,0.25,2.65,"mattress");
    box(root,rug,3.0,0.855,z+0.45,2.22,0.06,1.6,"duvet");
    box(root,fabric,3.0,0.9,z-1.42,2.35,1.25,0.17,"headboard");
    for(const x of [2.45,3.55]) box(root,white,x,0.93,z-0.85,0.86,0.2,0.55,"pillow");
    for(const x of [1.3,4.7]) {
      box(root,oak,x,0.46,z-0.9,0.65,0.52,0.6,"bedside_table");
      cylinder(root,white,x,0.95,z-0.9,0.18,0.32);
    }
    box(root,stone,5.25,0.95,z+0.2,0.7,1.6,2.0,"wardrobe");
    box(root,frame,4.88,0.95,z+0.2,0.025,1.5,0.025);
  }
  return root;
}

const directory = fileURLToPath(new URL("../public/assets/", import.meta.url));
await mkdir(directory, { recursive: true });
const modelScenes = [["courtyard.glb",building()],["interior.glb",interior()]];
for (const [filename, scene] of modelScenes) {
  const result = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true });
  const reloaded = await new GLTFLoader().parseAsync(result, "");
  const bounds = new THREE.Box3().setFromObject(reloaded.scene);
  assert(!bounds.isEmpty() && Number.isFinite(bounds.max.y), `${filename} must load into a finite scene`);
  if (filename === "courtyard.glb") for (let floor=0;floor<6;floor++) {
    assert(reloaded.scene.getObjectByName(`floor_${floor}`), `Missing floor_${floor}`);
  }
  await writeFile(`${directory}/${filename}`, Buffer.from(result));
  console.log(`${filename}: ${(result.byteLength / 1024).toFixed(1)} KB; GLTFLoader reload verified`);
}

// Render original geometry into a static thumbnail without WebGL or external artwork.
async function thumbnail(scene, filename, isInterior) {
  const width = 1400, height = 1064;
  const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 100);
  camera.position.set(17, isInterior ? 19 : 13, 21);
  camera.lookAt(0, isInterior ? 0.6 : 3.6, 0); camera.updateMatrixWorld();
  scene.updateMatrixWorld(true);
  const sun = new THREE.Vector3(-0.5, 1, 0.8).normalize();
  const pixels = Buffer.alloc(width * height * 4);
  const depths = new Float32Array(width * height).fill(Infinity);
  for (let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const radius = ((x-width*.5)/(width*.35))**2 + ((y-height*.83)/(height*.065))**2;
    const offset=(y*width+x)*4;
    pixels[offset]=70;pixels[offset+1]=91;pixels[offset+2]=73;
    pixels[offset+3]=Math.round(30*Math.exp(-radius*2));
  }
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const normal = new THREE.Vector3(), center = new THREE.Vector3();
  scene.traverse((object) => {
    if (!object.isMesh) return;
    const geometry = object.geometry, positions = geometry.attributes.position, indices = geometry.index;
    const count = indices?.count ?? positions.count;
    for (let i=0;i<count;i+=3) {
      a.fromBufferAttribute(positions,indices ? indices.getX(i) : i).applyMatrix4(object.matrixWorld);
      b.fromBufferAttribute(positions,indices ? indices.getX(i+1) : i+1).applyMatrix4(object.matrixWorld);
      c.fromBufferAttribute(positions,indices ? indices.getX(i+2) : i+2).applyMatrix4(object.matrixWorld);
      normal.subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).normalize();
      center.copy(a).add(b).add(c).multiplyScalar(1/3);
      if (normal.dot(new THREE.Vector3().subVectors(camera.position,center)) <= 0) continue;
      const color = object.material.color.clone().multiplyScalar(0.72 + Math.max(0,normal.dot(sun)) * 0.4).getHex();
      const points = [a,b,c].map((point) => {
        const depth = -point.clone().applyMatrix4(camera.matrixWorldInverse).z;
        point.project(camera);
        return { x:(point.x*0.5+0.5)*width,y:(-point.y*0.5+0.5)*height,depth };
      });
      const [p,q,r]=points;
      const minX=Math.max(0,Math.floor(Math.min(p.x,q.x,r.x))),maxX=Math.min(width-1,Math.ceil(Math.max(p.x,q.x,r.x)));
      const minY=Math.max(0,Math.floor(Math.min(p.y,q.y,r.y))),maxY=Math.min(height-1,Math.ceil(Math.max(p.y,q.y,r.y)));
      const denominator=(q.y-r.y)*(p.x-r.x)+(r.x-q.x)*(p.y-r.y);
      if(Math.abs(denominator)<1e-7)continue;
      for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
        const w1=((q.y-r.y)*(x+.5-r.x)+(r.x-q.x)*(y+.5-r.y))/denominator;
        const w2=((r.y-p.y)*(x+.5-r.x)+(p.x-r.x)*(y+.5-r.y))/denominator;
        const w3=1-w1-w2;
        if(w1<-.0001||w2<-.0001||w3<-.0001)continue;
        const depth=1/(w1/p.depth+w2/q.depth+w3/r.depth),index=y*width+x;
        if(depth>=depths[index])continue;
        depths[index]=depth;
        pixels[index*4]=(color>>16)&255; pixels[index*4+1]=(color>>8)&255;pixels[index*4+2]=color&255;pixels[index*4+3]=255;
      }
    }
  });
  await sharp(pixels,{raw:{width,height,channels:4}}).resize(1000,760).png().toFile(`${directory}/${filename}`);
  console.log(`${filename}: original scene thumbnail`);
}
await thumbnail(modelScenes[0][1], "courtyard-preview.png", false);
await thumbnail(modelScenes[1][1], "interior-preview.png", true);
