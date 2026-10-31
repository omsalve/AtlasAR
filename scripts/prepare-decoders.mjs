import { cp, mkdir } from "node:fs/promises";
await mkdir("public/vendor/draco", { recursive: true });
await mkdir("public/vendor/basis", { recursive: true });
await cp("node_modules/three/examples/jsm/libs/draco/gltf", "public/vendor/draco", { recursive: true });
await cp("node_modules/three/examples/jsm/libs/basis", "public/vendor/basis", { recursive: true });
await cp("node_modules/three/LICENSE", "public/vendor/THREE-LICENSE.txt");
console.log("Local Draco and KTX2/Basis decoder artifacts copied.");
