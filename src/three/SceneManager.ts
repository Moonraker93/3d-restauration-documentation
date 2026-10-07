import * as THREE from 'three';
import { MeshStandardNodeMaterial, PointsNodeMaterial, WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { formatValue, type Annotation, type DamageLayer, type Vec3Tuple } from '../types/project';

// Enable BVH-accelerated raycasting for fast picking on dense scans.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const PENDING_COLOR = new THREE.Color('#22d3ee');

export interface PickResult {
  point: THREE.Vector3;
  normal: THREE.Vector3 | null;
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const o = obj as unknown as {
      isCSS2DObject?: boolean;
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    if (o.isCSS2DObject) (obj as CSS2DObject).element.remove();
    o.geometry?.dispose();
    if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
    else o.material?.dispose();
  });
}

/** True when a material is a WebGPU node material (not a classic material). */
function isNodeMaterial(m: THREE.Material): boolean {
  return (m as unknown as { isNodeMaterial?: boolean }).isNodeMaterial === true;
}

/** Convert a classic lit material to the WebGPU node equivalent, preserving color/maps. */
function toNodeMeshMaterial(src: THREE.Material): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial();
  const anySrc = src as unknown as {
    color?: THREE.Color;
    map?: THREE.Texture | null;
    vertexColors?: boolean;
    transparent?: boolean;
    opacity?: number;
    roughness?: number;
    metalness?: number;
  };
  if (anySrc.color) m.color.copy(anySrc.color);
  if (anySrc.map) m.map = anySrc.map;
  if (anySrc.vertexColors) m.vertexColors = true;
  m.transparent = anySrc.transparent ?? false;
  m.opacity = anySrc.opacity ?? 1;
  m.roughness = anySrc.roughness ?? 0.9;
  m.metalness = anySrc.metalness ?? 0;
  return m;
}

function toNodePointsMaterial(src: THREE.Material): PointsNodeMaterial {
  const m = new PointsNodeMaterial();
  const anySrc = src as unknown as {
    color?: THREE.Color;
    size?: number;
    sizeAttenuation?: boolean;
    vertexColors?: boolean;
    map?: THREE.Texture | null;
  };
  if (anySrc.color) m.color.copy(anySrc.color);
  if (anySrc.size !== undefined) m.size = anySrc.size;
  if (anySrc.sizeAttenuation !== undefined) m.sizeAttenuation = anySrc.sizeAttenuation;
  if (anySrc.vertexColors) m.vertexColors = true;
  if (anySrc.map) m.map = anySrc.map;
  return m;
}

export class SceneManager {
  readonly canvas: HTMLCanvasElement;
  backendName = 'initializing…';

  private container: HTMLElement;
  private renderer!: WebGPURenderer;
  private labelRenderer!: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private modelRoot: THREE.Group | null = null;
  private annotationRoot = new THREE.Group();
  private pendingRoot = new THREE.Group();
  private resizeObserver: ResizeObserver | null = null;
  private markerRadius = 0.01;
  private modelRadius = 1;
  private ready = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'viewer-canvas';
    container.appendChild(this.canvas);
    this.scene.background = new THREE.Color(0x0b0d12);
  }

  async init(): Promise<void> {
    const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
    // WebGPURenderer falls back to a WebGL2 backend when WebGPU is unavailable.
    this.renderer = new WebGPURenderer({ canvas: this.canvas, antialias: true, forceWebGL: !hasWebGPU });
    await this.renderer.init();
    this.backendName =
      (this.renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2';

    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(width, height);
    this.labelRenderer.domElement.className = 'label-layer';
    this.container.appendChild(this.labelRenderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.01, 5000);
    this.camera.position.set(1, 0.8, 1.6);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    const hemisphere = new THREE.HemisphereLight(0xffffff, 0x404654, 1.6);
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(3, 5, 2);
    const fill = new THREE.DirectionalLight(0xcfd8ff, 1.0);
    fill.position.set(-4, -2, -3);
    const rim = new THREE.DirectionalLight(0xffffff, 0.8);
    rim.position.set(0, -3, -5);
    this.scene.add(hemisphere, key, fill, rim, this.annotationRoot, this.pendingRoot);

    this.raycaster.firstHitOnly = true;

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.container);

    this.renderer.setAnimationLoop(() => this.render());
    this.ready = true;
  }

  setModel(object: THREE.Object3D): void {
    if (!this.ready) return;
    if (this.modelRoot) {
      this.scene.remove(this.modelRoot);
      disposeObject(this.modelRoot);
      this.modelRoot = null;
    }
    const root = new THREE.Group();
    root.name = 'model-root';
    root.add(object);

    let hasPoints = false;
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        const geometry = mesh.geometry;
        // WebGPU's TSL pipeline needs a normal attribute to light MeshStandardMaterial;
        // many scans (and some loaders) omit them, which renders the model black.
        if (geometry.getAttribute('position') && !geometry.getAttribute('normal')) {
          geometry.computeVertexNormals();
        }
        if (!geometry.boundsTree && geometry.getAttribute('position')) {
          try {
            geometry.computeBoundsTree();
          } catch {
            // Non-fatal: picking falls back to the default raycast.
          }
        }
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        const materials = Array.isArray(material) ? material : material ? [material] : [];
        // GLTF/OBJ loaders hand back classic materials; the WebGPURenderer lights
        // meshes via TSL node materials, so convert any non-node lit material.
        const converted = materials.map((m) => (isNodeMaterial(m) ? m : toNodeMeshMaterial(m)));
        mesh.material = Array.isArray(material) ? converted : converted[0];
        converted.forEach((m) => {
          m.side = THREE.DoubleSide;
        });
      }
      const pts = child as THREE.Points;
      if (pts.isPoints) {
        hasPoints = true;
        const pm = pts.material as THREE.Material | undefined;
        if (pm && !isNodeMaterial(pm)) {
          pts.material = toNodePointsMaterial(pm);
        }
      }
    });

    const box = new THREE.Box3().setFromObject(root);
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const radius = Math.max(size.length() / 2, 1e-6);
      this.modelRadius = radius;
      this.markerRadius = radius * 0.008;
      if (hasPoints) this.raycaster.params.Points.threshold = radius * 0.01;
      this.camera.near = Math.max(radius / 1000, 1e-6);
      this.camera.far = Math.max(radius * 100, 10);
      this.camera.position.set(center.x + radius * 1.1, center.y + radius * 0.8, center.z + radius * 1.5);
      this.camera.updateProjectionMatrix();
      this.controls.target.copy(center);
      this.controls.update();
    }

    this.modelRoot = root;
    this.scene.add(root);
  }

  /** Raycast from client (mouse) coordinates into the loaded model. */
  pick(clientX: number, clientY: number): PickResult | null {
    if (!this.ready || !this.modelRoot) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.modelRoot, true)[0];
    if (!hit) return null;
    return {
      point: hit.point.clone(),
      normal: hit.face?.normal ? hit.face.normal.clone() : null,
    };
  }

  /** Rebuild all annotation visuals from state. Call whenever annotations/layers change. */
  syncAnnotations(
    annotations: Annotation[],
    layers: DamageLayer[],
    selectedId: string | null,
    unit: string,
  ): void {
    this.clearGroup(this.annotationRoot);
    const layerById = new Map(layers.map((l) => [l.id, l]));
    for (const annotation of annotations) {
      const layer = layerById.get(annotation.layerId);
      if (layer && !layer.visible) continue;
      this.annotationRoot.add(this.buildAnnotation(annotation, layer, annotation.id === selectedId, unit));
    }
  }

  /** Preview visuals for the in-progress measurement/area outline. */
  setPending(points: Vec3Tuple[], showAreaPreview: boolean): void {
    this.clearGroup(this.pendingRoot);
    if (points.length === 0) return;
    const vectors = points.map((p) => new THREE.Vector3(...p));
    for (const v of vectors) this.pendingRoot.add(this.makeMarker(v, PENDING_COLOR, 0.85));
    if (vectors.length >= 2) {
      this.pendingRoot.add(
        new THREE.Line(new THREE.BufferGeometry().setFromPoints(vectors), new THREE.LineBasicMaterial({ color: PENDING_COLOR })),
      );
    }
    if (showAreaPreview && vectors.length >= 3) {
      this.pendingRoot.add(this.makeAreaFill(vectors, PENDING_COLOR, 0.15));
    }
  }

  /** Move the camera target to an annotation's centroid, keeping the view offset. */
  focusOn(points: Vec3Tuple[]): void {
    if (!this.ready || points.length === 0) return;
    const center = new THREE.Vector3();
    for (const p of points) center.add(new THREE.Vector3(...p));
    center.divideScalar(points.length);
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.setLength(Math.min(offset.length(), this.modelRadius * 1.2));
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(offset);
    this.controls.update();
  }

  /** Render a frame and capture the canvas as a PNG data URL (for reports). */
  screenshot(): string | null {
    if (!this.ready) return null;
    try {
      this.render();
      return this.canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  dispose(): void {
    this.ready = false;
    this.renderer?.setAnimationLoop(null);
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    if (this.modelRoot) disposeObject(this.modelRoot);
    disposeObject(this.annotationRoot);
    disposeObject(this.pendingRoot);
    this.renderer?.dispose();
    this.canvas.remove();
    this.labelRenderer?.domElement.remove();
  }

  // ---------------------------------------------------------------- internals

  private render(): void {
    if (!this.ready) return;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  private onResize(): void {
    if (!this.ready) return;
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.labelRenderer.setSize(width, height);
  }

  private clearGroup(root: THREE.Group): void {
    for (const child of [...root.children]) {
      root.remove(child);
      disposeObject(child);
    }
  }

  private makeMarker(position: THREE.Vector3, color: THREE.Color, scale = 1): THREE.Mesh {
    // SphereGeometry has no "normal" attribute until computed; WebGPU's TSL
    // pipeline warns about it even for unlit materials. Compute once here.
    const geometry = new THREE.SphereGeometry(this.markerRadius * scale, 12, 8);
    geometry.computeVertexNormals();
    const marker = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color, depthTest: true }),
    );
    marker.position.copy(position);
    return marker;
  }

  private makeLabel(text: string, color: string, anchor: THREE.Vector3, selected: boolean): CSS2DObject {
    const div = document.createElement('div');
    div.className = selected ? 'annotation-label selected' : 'annotation-label';
    div.style.borderColor = color;
    div.textContent = text;
    const label = new CSS2DObject(div);
    label.position.copy(anchor);
    label.position.y += this.markerRadius * 2.5;
    return label;
  }

  private makeAreaFill(points: THREE.Vector3[], color: THREE.Color, opacity: number): THREE.Mesh {
    const positions = new Float32Array(points.length * 3);
    points.forEach((p, i) => {
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
    });
    const indices: number[] = [];
    for (let i = 1; i < points.length - 1; i++) indices.push(0, i, i + 1);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals(); // satisfy WebGPU TSL even though material is unlit
    return new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }),
    );
  }

  private buildAnnotation(
    annotation: Annotation,
    layer: DamageLayer | undefined,
    selected: boolean,
    unit: string,
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = `annotation-${annotation.id}`;
    const colorHex = layer?.color ?? '#9ca3af';
    const color = new THREE.Color(colorHex);
    const points = annotation.points.map((p) => new THREE.Vector3(...p));
    const markerScale = selected ? 1.4 : 1;

    if (annotation.kind === 'point') {
      group.add(this.makeMarker(points[0], color, markerScale));
      group.add(this.makeLabel(annotation.label, colorHex, points[0], selected));
      return group;
    }

    if (annotation.kind === 'measure' && points.length >= 2) {
      group.add(this.makeMarker(points[0], color, markerScale));
      group.add(this.makeMarker(points[1], color, markerScale));
      group.add(
        new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color })),
      );
      const mid = points[0].clone().add(points[1]).multiplyScalar(0.5);
      const value = annotation.distance ?? points[0].distanceTo(points[1]);
      group.add(this.makeLabel(`${annotation.label} · ${formatValue(value)} ${unit}`, colorHex, mid, selected));
      return group;
    }

    if (annotation.kind === 'area' && points.length >= 3) {
      points.forEach((p) => group.add(this.makeMarker(p, color, markerScale * 0.8)));
      // WebGPURenderer does not support THREE.LineLoop — use a closed Line instead.
      const outline = new THREE.BufferGeometry().setFromPoints([...points, points[0]]);
      group.add(new THREE.Line(outline, new THREE.LineBasicMaterial({ color })));
      group.add(this.makeAreaFill(points, color, 0.3));
      const centroid = points.reduce((acc, p) => acc.add(p), new THREE.Vector3()).divideScalar(points.length);
      group.add(
        this.makeLabel(`${annotation.label} · ${formatValue(annotation.area ?? 0)} ${unit}²`, colorHex, centroid, selected),
      );
    }
    return group;
  }
}
