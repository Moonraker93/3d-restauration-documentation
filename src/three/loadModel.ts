import * as THREE from 'three';
import { MeshStandardNodeMaterial, PointsNodeMaterial } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

export const MODEL_EXTENSIONS = ['glb', 'gltf', 'obj', 'ply', 'stl', 'xyz', 'pts'];
export const MODEL_ACCEPT = MODEL_EXTENSIONS.map((ext) => `.${ext}`).join(',');

const DEFAULT_MESH_COLOR = 0xc7c0b4;

// The WebGPURenderer lights models through the TSL node-material pipeline; the
// classic MeshStandardMaterial does not receive computed normals reliably there
// (renders black). Use node materials for anything we create ourselves.
function makeMeshMaterial(opts: { vertexColors?: boolean } = {}): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial();
  m.color.set(opts.vertexColors ? 0xffffff : DEFAULT_MESH_COLOR);
  m.roughness = 0.9;
  m.metalness = 0;
  if (opts.vertexColors) m.vertexColors = true;
  return m;
}

/**
 * Load a 3D model from a Blob/File. Meshes are returned as-is (with sane
 * fallback materials for OBJ/STL/PLY); face-less PLY and XYZ/PTS files are
 * returned as point clouds.
 */
export async function loadModelFromBlob(blob: Blob, fileName: string): Promise<THREE.Object3D> {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const buffer = await blob.arrayBuffer();
  switch (ext) {
    case 'glb':
    case 'gltf': {
      const gltf = await new GLTFLoader().parseAsync(buffer, '');
      return gltf.scene;
    }
    case 'obj': {
      const group = new OBJLoader().parse(new TextDecoder().decode(buffer));
      const material = makeMeshMaterial();
      group.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.material = material;
          if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();
        }
      });
      return group;
    }
    case 'ply': {
      const geometry = new PLYLoader().parse(buffer);
      return geometry.getIndex() ? plyToMesh(geometry) : makePoints(geometry);
    }
    case 'stl': {
      const geometry = new STLLoader().parse(buffer);
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      return new THREE.Mesh(geometry, makeMeshMaterial());
    }
    case 'xyz':
    case 'pts': {
      return parsePointText(new TextDecoder().decode(buffer));
    }
    default:
      throw new Error(`Unsupported model format ".${ext}". Supported: ${MODEL_EXTENSIONS.join(', ')}`);
  }
}

function plyToMesh(geometry: THREE.BufferGeometry): THREE.Mesh {
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const hasColor = !!geometry.getAttribute('color');
  return new THREE.Mesh(geometry, makeMeshMaterial({ vertexColors: hasColor }));
}

function makePoints(geometry: THREE.BufferGeometry): THREE.Points {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const diag = box ? box.getSize(new THREE.Vector3()).length() : 1;
  const hasColor = !!geometry.getAttribute('color');
  const material = new PointsNodeMaterial();
  material.size = Math.max(diag * 0.0015, 1e-5);
  material.sizeAttenuation = true;
  material.color.set(hasColor ? 0xffffff : 0xcfccc6);
  if (hasColor) material.vertexColors = true;
  return new THREE.Points(geometry, material);
}

/** Parse ASCII point clouds: "x y z [r g b]" per line (rgb in 0-1 or 0-255). */
function parsePointText(text: string): THREE.Points {
  const positions: number[] = [];
  const colors: number[] = [];
  let hasColor = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const parts = line.split(/[\s,;]+/).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) continue; // also skips PTS count headers
    positions.push(parts[0], parts[1], parts[2]);
    if (parts.length >= 6 && !parts.slice(3, 6).some(Number.isNaN)) {
      hasColor = true;
      let [r, g, b] = [parts[3], parts[4], parts[5]];
      if (r > 1 || g > 1 || b > 1) {
        r /= 255;
        g /= 255;
        b /= 255;
      }
      colors.push(r, g, b);
    } else {
      colors.push(1, 1, 1);
    }
  }
  if (positions.length === 0) throw new Error('No points found in file.');
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (hasColor) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return makePoints(geometry);
}
