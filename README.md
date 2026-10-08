# 3D Artwork Annotator

A modern, performant web app for restorers and conservators to **annotate, measure and map damage** on 3D digitized artworks — for documentation and restoration planning. Inspired by [meshnotes.org](https://meshnotes.org/). Built entirely with open-source tools.

## Features

- **3D model loading**: glTF/GLB, OBJ, PLY (mesh *and* point cloud), STL, XYZ/PTS point clouds
- **WebGPU rendering** via Three.js `WebGPURenderer` with automatic **WebGL2 fallback** when WebGPU is unavailable
- **Point-to-point measurement** — click two surface points, get the distance
- **Path measurement** — trace an open line (e.g. a crack) along the surface, get its total length
- **Area mapping** — outline a damage region on the surface (3+ points), get the enclosed surface area
- **Point annotations** — pin notes anywhere on the surface
- **Shape editing** — click an annotation's label (or **Edit shape**) to drag its nodes along the surface with live updated values; confirm with `Enter` / double-click, cancel with `Esc`
- **Damage layers** — categorized, color-coded layers (cracks, material loss, discoloration, …); every annotation lives on a layer, and one layer is the *active* layer that receives new annotations
- **Visibility control** — hide/show whole layers or individual annotations (from the layer rows or the grouped annotation list)
- **Occlusion-aware labels and markers** — annotations hidden from the camera by the model itself are not drawn
- **Start a new project at any time** — the **New project** button replaces the loaded model and annotations (with confirmation)
- **PDF report export** — project overview, per-layer damage tables, all measurements/areas/notes, and a viewport screenshot
- **Portable project files** — everything (model + layers + annotations) saved as a single `.a3d` file (a ZIP package) that can be reopened to continue work
- **Fast picking on large scans** via `three-mesh-bvh` accelerated raycasting

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:5173 — works best in a WebGPU-capable browser (Chrome/Edge), and falls back to WebGL2 elsewhere.

## Usage

1. **New project from 3D model** — pick a `.glb / .gltf / .obj / .ply / .stl / .xyz / .pts` file, or **Open project** with an existing `.a3d` file.
2. Choose a tool in the left toolbar (shortcuts: `V` navigate, `M` measure, `P` path, `A` area, `N` note):
   - **Measure**: click two points on the surface.
   - **Path**: click at least 2 points along a line, then press `Enter` or double-click to finish.
   - **Area**: click at least 3 outline points, then press `Enter` or double-click to finish. `Backspace` removes the last point, `Esc` cancels.
   - **Note**: click the surface to place an annotation pin.
3. Pick the active layer (target icon) before annotating, or reassign an annotation's layer, label and notes in the right panel. Use the eye icons to hide layers or single annotations.
4. **Edit shape**: click a label (or use **Edit shape** in the panel), drag the white nodes, then `Enter` / double-click to confirm or `Esc` to cancel.
5. **Save Project** writes a single `.a3d` file; **Export Report** writes a PDF.

## Project file format (`.a3d`)

A `.a3d` file is a standard ZIP archive:

```
project.json      # version, name, unit, layers, annotations (points in model coordinates)
model/<name>      # the original 3D model file
```

## Tech stack (all open source)

| Concern | Library | License |
| --- | --- | --- |
| Rendering | [Three.js](https://threejs.org) (WebGPURenderer, WebGL2 fallback) | MIT |
| Fast raycasting | [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | MIT |
| UI | [React](https://react.dev) + [Vite](https://vite.dev) + [TypeScript](https://www.typescriptlang.org) | MIT |
| State | [zustand](https://github.com/pmndrs/zustand) | MIT |
| Icons | [lucide-react](https://lucide.dev) | ISC |
| Project packaging | [JSZip](https://stuk.github.io/jszip/) | MIT |
| PDF reports | [jsPDF](https://github.com/parallax/jsPDF) | MIT |

## Roadmap

- **Further PDF report improvements** — better layout, per-layer sections with images, optional filtering (e.g. skip hidden layers/annotations)
- **Project metadata** — artwork title, artist, inventory number, dimensions, materials, author/date, condition summary; stored in the `.a3d` file and shown in the report
- **More advanced annotation tools** — e.g. geodesic (surface) distances, angles, freehand/brush marking, circle/ellipse regions, annotation grouping and copy/duplicate
- **Rendering, screenshot and camera improvements** — high-resolution screenshots with transparent background, lighting/background presets, saved camera views/bookmarks, orthographic view, smoother focus
- **Automated 6-sided render pass** — one click renders the model from front, back, left, right, top and bottom (with annotations optionally visible), and the images can be exported individually, as a ZIP, or embedded in the PDF report

## Notes & limitations

- Measurements are straight-line (Euclidean); surface-geodesic distances are a possible future addition.
- Area values are the sum of the triangle fan spanning the picked outline points (a surface-patch approximation).
- Area overlays are projected onto the model surface so they follow curved geometry (if the projection is not possible, a flat patch is drawn instead), and use a small depth bias so they do not z-fight with the model.
- LAS/LAZ and E57 laser-scan formats are not yet supported (convert to PLY/XYZ first).
- Units are whatever your model uses; set the unit label (default `m`) in the top bar so reports read correctly.

## License

[MIT](LICENSE) — free to use, modify and distribute. All dependencies are open source as well (see the table above).
