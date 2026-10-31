import { mkdir, writeFile, cp } from "node:fs/promises";
const sources = {
  "TensorFlow-Apache-2.0.txt": "https://raw.githubusercontent.com/tensorflow/tfjs/master/LICENSE",
  "Draco-Apache-2.0.txt": "https://raw.githubusercontent.com/google/draco/main/LICENSE",
  "Basis-Universal-Apache-2.0.txt": "https://raw.githubusercontent.com/BinomialLLC/basis_universal/master/LICENSE",
  "Meshoptimizer-MIT.txt": "https://raw.githubusercontent.com/zeux/meshoptimizer/master/LICENSE.md",
};
await mkdir("public/vendor/licenses",{recursive:true});
for(const [name,url] of Object.entries(sources)) {
  const response=await fetch(url);
  if(!response.ok) throw new Error(`Could not fetch ${name}: ${response.status}`);
  await writeFile(`public/vendor/licenses/${name}`,await response.text());
}
for(const [name,source] of Object.entries({
  "React-MIT.txt":"node_modules/react/LICENSE",
  "React-DOM-MIT.txt":"node_modules/react-dom/LICENSE",
  "Next-MIT.txt":"node_modules/next/license.md",
  "QRCode-MIT.txt":"node_modules/qrcode/license",
  "Fflate-MIT.txt":"node_modules/fflate/LICENSE",
  "Lucide-ISC.txt":"node_modules/lucide-react/LICENSE",
  "AtlasAR-MIT.txt":"LICENSE",
})) await cp(source,`public/vendor/licenses/${name}`);
console.log("Retained runtime decoder and TensorFlow license texts.");
