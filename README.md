# 3D Artwork Annotator

A modern, performant web app for restorers and conservators to **annotate, measure and map damage** on 3D digitized artworks — for documentation and restoration planning. Inspired by [meshnotes.org](https://meshnotes.org/). Built entirely with open-source tools.

## Features

- **3D model loading**: glTF/GLB, OBJ, PLY (mesh *and* point cloud), STL, XYZ/PTS point clouds
- **WebGPU rendering** via Three.js `WebGPURenderer` with automatic **WebGL2 fallback** when WebGPU is unavailable
- **Point-to-point measurement** — click two surface points, get the distance
- **Area mapping** — outline a damage region on the surface (3+ points), get the enclosed surface area
- **Point annotations** — pin notes anywhere on the surface
- **Damage layers** — categorized, color-coded layers (cracks, material loss, discoloration, …) with visibility toggles; every annotation lives on a layer
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
2. Choose a tool in the left toolbar (shortcuts: `V` navigate, `M` measure, `A` area, `N` note):
   - **Measure**: click two points on the surface.
   - **Area**: click at least 3 outline points, then press `Enter` or double-click to finish. `Backspace` removes the last point, `Esc` cancels.
   - **Note**: click the surface to place an annotation pin.
3. Assign each annotation to a damage layer, edit labels and notes in the right panel.
4. **Save Project** writes a single `.a3d` file; **Export Report** writes a PDF.

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

## Notes & roadmap

- Measurements are straight-line (Euclidean); surface-geodesic distances are a possible future addition.
- Area values are the sum of the triangle fan spanning the picked outline points (a surface-patch approximation).
- LAS/LAZ and E57 laser-scan formats are not yet supported (convert to PLY/XYZ first).
- Units are whatever your model uses; set the unit label (default `m`) in the top bar so reports read correctly.

## License

[MIT](LICENSE) — free to use, modify and distribute. All dependencies are open source as well (see the table above).
