# Asset pipeline

## Scope and file policy

Atlas AR loads explicit assets from a validated manifest. Models are rendered; uploads are never imported as JavaScript or injected as HTML. There is no optimization server or required asset-hosting account.

| Asset | Accepted input | Limit | Validation boundary |
|---|---|---|---|
| Exterior/interior | GLB 2.0; self-contained glTF 2.0 | 25 MiB each | Extension, bytes, GLB magic/version/declared length/chunk bounds, JSON, version and embedded-resource policy; then GLTFLoader |
| Target image/media | PNG, JPEG, WebP | 8 MiB | Actual signature/MIME, browser decode, 128–4096 pixels per dimension |
| Trained target | Single-image MindAR v2 `.mind` | 10 MiB | MessagePack envelope/version and one-target marker; deeper loading by MindAR |
| Manifest | Schema version 1 | 256 KiB in packages/share encoding | Whitelisted fields, bounded text/vectors, identifiers, safe URLs, unique POIs/floors |
| Backup/package | Atlas AR ZIP | 100 MiB combined input/assets | Safe paths, one matching manifest, entry/expanded-size budgets, then referenced-asset validation |

`lib/assets.ts` implements upload checks, `lib/validation.ts` parses configuration, `lib/storage.ts` stores Blobs/configuration, and `lib/scene.ts` configures actual model loaders. Validation prevents common errors and unsafe URL schemes; it is not proof that a model fits every GPU or is harmless under every decoder implementation.

Models have upper rejection limits of 50,000 nodes, 20,000 meshes and 256 texture declarations. These are not performance recommendations. GLB JSON chunks are capped at 4 MiB. Unrecognized extensions can still fail during actual decoding with visible feedback.

## Prepare architecture

1. Remove invisible construction details, duplicated furniture, high-poly plants and tiny fixtures.
2. Apply transforms and use a Y-up glTF export. Keep sensible source units; runtime normalizes its loaded copy.
3. Reuse meshes/materials, reduce draw calls and bake expensive procedural materials into compatible PBR textures.
4. Export one self-contained `.glb`. For `.gltf`, embed every buffer/texture as supported data URIs. Blob URLs do not preserve a folder of missing dependencies.
5. Export interiors separately. The MVP supports one separate configured interior, loaded only when opened.
6. Check the output with the [Khronos glTF Validator](https://github.khronos.org/glTF-Validator/) and load it on a representative phone before publication.

[Blender's license](https://www.blender.org/about/license/) permits commercial artwork creation; exported artwork is not automatically GPL. Architecture, furniture and texture rights remain separate. Use material you own or are authorized to distribute.

## Coordinates and floor names

`prepareModel()` computes complete bounds, centers X/Z, places the base at Y=0 and scales the maximum horizontal dimension to 12 units. POI anchors, camera positions and targets use this normalized space. Normalization precedes floor isolation, so changing visibility does not resize/recenter the building.

The sample uses explicit independent floor roots:

```text
Courtyard_Residences
├── landscape
├── floor_0
├── floor_1
├── floor_2
├── floor_3
├── floor_4
└── floor_5
```

Place all parts that hide with a floor below its root. Unmapped landscape/structure stays visible. Map each floor label to exact node names in the editor. Use sibling floor roots: selecting a nested child under a hidden floor parent cannot reveal that child.

The runtime does not infer storeys from arbitrary geometry. Split a single-mesh model in the authoring tool or omit its floor mapping. A floor selector cannot manufacture separable data.

The interior is normalized independently and shown as an orbitable cutaway. It need not share exterior coordinates. Opening it does not claim that the phone has localized a visitor inside a real apartment.

## Mobile budgets and compression

Aim below 10 MiB for exteriors, modest material counts and 1K–2K textures. Measure triangle/draw-call budgets on target devices. Compressed download size is not GPU memory: a 4096×4096 RGBA texture represents roughly 64 MiB before mipmaps/compression effects.

[glTF Transform](https://gltf-transform.dev/cli) offers an optional local pipeline. After installing the CLI, inspect the source and write a separate optimized output:

```sh
gltf-transform inspect source.glb
gltf-transform optimize source.glb optimized.glb --compress meshopt --texture-size 2048
```

Check installed CLI help before choosing texture codecs. KTX2 encoding can need another local encoder executable. Draco/Meshopt reduce geometry transfers; KTX2/Basis can improve texture bandwidth/GPU memory on supporting devices.

The runtime configures Draco at `/vendor/draco/`, Meshopt from the pinned Three package, and KTX2/Basis at `/vendor/basis/`, with renderer capability detection. Include decoder files in deployment. Actual compression combinations need load tests; uncompressed samples do not exercise every decoder.

The MVP loads exterior/interior separately and bounds render resolution. It has no automatic LOD generation, progressive mesh streaming, background transcoding, decimation service or universal performance guarantee.

## Image target workflow

`ar.targetImageUrl` is the printable/display image; `ar.targetMindUrl` is features compiled from that exact image. A preview is not tracking data.

Use the local compiler for one detailed natural-feature image, 256–2048 pixels per side and at most 8 MiB. It requires at least 40 matching features. Preserve aspect ratio/framing when printing. Compilation can succeed for weak targets; physical recognition still needs testing. Approximately 1024 pixels is a useful starting point. Separate preview uploads permit 128–4096 pixels; they do not retrain the target.

The default `target.png`/`target.mind` pair provides a repeatable sample. Replacing only the image does not retrain `.mind`. When recognition fails, check the pairing, lighting, glare, blur, print size and feature diversity before diagnosing a renderer failure.

AR uses a real tracked anchor and the engine's calibrated camera. Drag/scale modifies a child wrapper. Found/lost callbacks drive feedback; the lost anchor is hidden, not shown as an accurate persistent world pose.

## Storage and publication

Blobs are addressed by `idb:<UUID>`, private to the origin/profile. The resolver creates temporary Blob URLs, which callers revoke on cleanup. Manifests reject arbitrary `blob:`, `data:`, `javascript:`, credentialed or protocol-relative asset URLs.

Packages rewrite uploads to `/projects/<id>/assets/<UUID>.<extension>` and include `projects/<id>/project.json`. Existing bundled/HTTPS references remain references. Publish this directory alongside the full static application for cross-device access. Backup import validates referenced assets and creates a copy when its ID already exists.

Original architecture/interior/thumbnails come from `scripts/generate-assets.mjs`, which reloads exported GLBs. Preserve original and third-party notices. Exporting a package does not grant rights in user-uploaded architecture or media.
