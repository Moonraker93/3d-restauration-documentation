import * as THREE from 'three';
import { MeshStandardNodeMaterial, PointsNodeMaterial, WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { formatValue, pathLength, type Annotation, type DamageLayer, type Vec3Tuple } from '../types/project';
import { outlineNormal, planeBasis, subdividePlanarTriangles } from './geometry';

// Enable BVH-accelerated raycasting for fast picking on dense scans.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const PENDING_COLOR = new THREE.Color('#22d3ee');
/** Fallback color for annotations whose layer is missing. */
const DEFAULT_ANNOTATION_COLOR = '#9ca3af';

export interface PickResult {
  point: THREE.Vector3;
  normal: THREE.Vector3 | null;
}

/**
 * A built annotation visual plus the inputs it was built from. `syncAnnotations`
 * compares these against the incoming state to decide whether the group can be
 * reused as-is instead of being disposed and rebuilt.
 */
interface AnnotationVisual {
  group: THREE.Group;
  annotation: Annotation;
  /** Appearance inputs baked into the group — a change in any of them forces a rebuild. */
  colorHex: string;
  selected: boolean;
  unit: string;
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

/** Point halfway along an open polyline (by arc length) — used for label placement. */
function polylineMidpoint(points: THREE.Vector3[]): THREE.Vector3 {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += points[i - 1].distanceTo(points[i]);
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const segment = points[i - 1].distanceTo(points[i]);
    if (segment > 0 && walked + segment >= total / 2) {
      return points[i - 1].clone().lerp(points[i], (total / 2 - walked) / segment);
    }
    walked += segment;
  }
  return points[points.length - 1].clone();
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
  private editRoot = new THREE.Group();
  private resizeObserver: ResizeObserver | null = null;
  private markerRadius = 0.01;
  private modelRadius = 1;
  private ready = false;
  private labelsDirty = true;
  private lastCameraMatrix = new THREE.Matrix4();
  private lastModelRoot: THREE.Group | null = null;
  /** Annotation id → its built visual, so unchanged annotations are not rebuilt. */
  private annotationVisuals = new Map<string, AnnotationVisual>();

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
    this.scene.add(hemisphere, key, fill, rim, this.annotationRoot, this.pendingRoot, this.editRoot);

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

  /**
   * Sync annotation visuals with state, rebuilding only what actually changed.
   *
   * The store hands back the *same object reference* for every annotation/layer it
   * did not touch, so an identity check — plus the appearance inputs baked into the
   * built group — is enough to reuse a visual and skip the rebuild entirely.
   */
  syncAnnotations(
    annotations: Annotation[],
    layers: DamageLayer[],
    selectedId: string | null,
    unit: string,
  ): void {
    const layerById = new Map(layers.map((l) => [l.id, l]));
    const visible = new Map<string, { annotation: Annotation; colorHex: string; selected: boolean }>();
    for (const annotation of annotations) {
      const layer = layerById.get(annotation.layerId);
      if ((layer && !layer.visible) || annotation.hidden) continue;
      visible.set(annotation.id, {
        annotation,
        colorHex: layer?.color ?? DEFAULT_ANNOTATION_COLOR,
        selected: annotation.id === selectedId,
      });
    }

    let changed = false;

    // Evict visuals whose annotation disappeared, was hidden, or lost its layer.
    for (const [id, visual] of this.annotationVisuals) {
      if (!visible.has(id)) {
        this.removeAnnotationVisual(id, visual);
        changed = true;
      }
    }

    // Reuse untouched visuals; rebuild the ones whose inputs changed.
    for (const [id, next] of visible) {
      const cached = this.annotationVisuals.get(id);
      if (
        cached &&
        cached.annotation === next.annotation &&
        cached.colorHex === next.colorHex &&
        cached.selected === next.selected &&
        cached.unit === unit
      ) {
        continue;
      }
      if (cached) this.removeAnnotationVisual(id, cached);
      this.addAnnotationVisual(id, next.annotation, next.colorHex, next.selected, unit);
      changed = true;
    }

    // Only re-run the occlusion pass when the label set actually changed.
    if (changed) this.labelsDirty = true;
  }

  private removeAnnotationVisual(id: string, visual: AnnotationVisual): void {
    this.annotationRoot.remove(visual.group);
    disposeObject(visual.group);
    this.annotationVisuals.delete(id);
  }

  private addAnnotationVisual(
    id: string,
    annotation: Annotation,
    colorHex: string,
    selected: boolean,
    unit: string,
  ): void {
    const group = this.buildAnnotation(annotation, colorHex, selected, unit);
    // Lets the UI map a clicked label back to its annotation.
    group.traverse((obj) => {
      if (obj instanceof CSS2DObject) obj.element.dataset.annotationId = id;
    });
    this.annotationRoot.add(group);
    this.annotationVisuals.set(id, { group, annotation, colorHex, selected, unit });
  }

  /** Show draggable node handles for shape editing (null clears them). */
  setEditHandles(points: Vec3Tuple[] | null): void {
    this.clearGroup(this.editRoot);
    if (!points) return;
    const color = new THREE.Color('#ffffff');
    points.forEach((p, index) => {
      const handle = this.makeMarker(new THREE.Vector3(...p), color, 1.9);
      handle.userData.handleIndex = index;
      this.editRoot.add(handle);
    });
  }

  /** Index of the edit handle under the pointer, or null. Occluded handles are ignored. */
  pickHandle(clientX: number, clientY: number): number | null {
    if (!this.ready || this.editRoot.children.length === 0) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const handleHit = this.raycaster.intersectObjects(this.editRoot.children, false)[0];
    if (!handleHit) return null;
    const modelHit = this.modelRoot ? this.raycaster.intersectObject(this.modelRoot, true)[0] : null;
    if (modelHit && modelHit.distance < handleHit.distance - this.markerRadius * 3) return null;
    return handleHit.object.userData.handleIndex as number;
  }

  setControlsEnabled(enabled: boolean): void {
    if (this.controls) this.controls.enabled = enabled;
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
    // `disposeObject(annotationRoot)` releases every cached group, so just forget the entries.
    this.annotationVisuals.clear();
    disposeObject(this.annotationRoot);
    disposeObject(this.pendingRoot);
    disposeObject(this.editRoot);
    this.renderer?.dispose();
    this.canvas.remove();
    this.labelRenderer?.domElement.remove();
  }

  // ---------------------------------------------------------------- internals

  private render(): void {
    if (!this.ready) return;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.updateLabelOcclusion();
    this.labelRenderer.render(this.scene, this.camera);
  }

  /** Hide labels whose anchor point is hidden behind the model from the camera. */
  private updateLabelOcclusion(): void {
    this.camera.updateMatrixWorld();
    const unchanged =
      !this.labelsDirty &&
      this.lastCameraMatrix.equals(this.camera.matrixWorld) &&
      this.lastModelRoot === this.modelRoot;
    if (unchanged) return;
    this.labelsDirty = false;
    this.lastCameraMatrix.copy(this.camera.matrixWorld);
    this.lastModelRoot = this.modelRoot;

    const origin = this.camera.position;
    const savedFar = this.raycaster.far;
    const savedNear = this.raycaster.near;
    this.annotationRoot.traverse((obj) => {
      const anchor = obj.userData.occlusionPoint as THREE.Vector3 | undefined;
      if (!anchor) return;
      if (!this.modelRoot) {
        obj.visible = true;
        return;
      }
      const dir = anchor.clone().sub(origin);
      const distance = dir.length();
      this.raycaster.set(origin, dir.normalize());
      this.raycaster.near = 0;
      this.raycaster.far = distance;
      const hit = this.raycaster.intersectObject(this.modelRoot, true)[0];
      // The anchor sits on the surface, so only hits clearly in front of it count as occlusion.
      obj.visible = !hit || hit.distance >= distance - this.markerRadius * 3;
    });
    this.raycaster.near = savedNear;
    this.raycaster.far = savedFar;
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
    label.userData.occlusionPoint = anchor.clone();
    return label;
  }

  /**
   * Fill for an area outline. With `conform` the patch is projected onto the model
   * surface so it follows curved geometry; otherwise (live preview, or a failed
   * projection) it is a flat triangle fan through the outline points.
   */
  private makeAreaFill(
    points: THREE.Vector3[],
    color: THREE.Color,
    opacity: number,
    conform = false,
  ): THREE.Mesh {
    const geometry = (conform ? this.conformAreaToSurface(points) : null) ?? this.fanGeometry(points);
    return new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
        // A coplanar overlay z-fights with the surface without a depth bias.
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
  }

  /** Flat triangle-fan fill through the outline points (fallback / live preview). */
  private fanGeometry(points: THREE.Vector3[]): THREE.BufferGeometry {
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
    return geometry;
  }

  /**
   * Build a surface-conforming fill for an area outline: flatten the outline into
   * its best-fit plane, triangulate and subdivide it, then project every vertex
   * back onto the model. Returns null when no usable projection exists, so the
   * caller can fall back to the flat fan.
   */
  private conformAreaToSurface(points: THREE.Vector3[]): THREE.BufferGeometry | null {
    if (!this.modelRoot) return null;
    const normal = outlineNormal(points);
    if (!normal) return null;
    const { u, v } = planeBasis(normal);

    const origin = points[0];
    const flat = points.map((p) => {
      const offset = p.clone().sub(origin);
      return new THREE.Vector2(offset.dot(u), offset.dot(v));
    });
    const triangles = THREE.ShapeUtils.triangulateShape(flat, []);
    if (triangles.length === 0) return null;

    const maxEdge = Math.max(this.markerRadius * 6, this.modelRadius * 0.01);
    const { positions, indices } = subdividePlanarTriangles(flat, triangles, maxEdge);

    const array = new Float32Array(positions.length * 3);
    positions.forEach((p, i) => {
      const planar = origin.clone().addScaledVector(u, p.x).addScaledVector(v, p.y);
      const snapped = this.snapToSurface(planar, normal) ?? planar;
      array[i * 3] = snapped.x;
      array[i * 3 + 1] = snapped.y;
      array[i * 3 + 2] = snapped.z;
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(array, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals(); // satisfy WebGPU TSL even though material is unlit
    return geometry;
  }

  /**
   * Nearest surface point hit along `+normal` or `-normal` from a planar position,
   * or null when neither direction reaches the model. Testing both directions keeps
   * the projection working for surfaces that fold either way relative to the plane.
   */
  private snapToSurface(position: THREE.Vector3, normal: THREE.Vector3): THREE.Vector3 | null {
    if (!this.modelRoot) return null;
    const savedNear = this.raycaster.near;
    const savedFar = this.raycaster.far;
    this.raycaster.near = 0;
    this.raycaster.far = Infinity;

    let best: THREE.Vector3 | null = null;
    let bestDistance = Infinity;
    for (const sign of [-1, 1]) {
      const dir = normal.clone().multiplyScalar(sign);
      // Start a little off the plane so the ray crosses the surface near `position`.
      const start = position.clone().addScaledVector(dir, -this.markerRadius * 4);
      this.raycaster.set(start, dir);
      const hit = this.raycaster.intersectObject(this.modelRoot, true)[0];
      if (!hit) continue;
      const distance = hit.point.distanceTo(position);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = hit.point.clone();
      }
    }

    this.raycaster.near = savedNear;
    this.raycaster.far = savedFar;
    return best;
  }

  /**
   * Build the visuals for one annotation. Everything baked in here (`annotation`,
   * `colorHex`, `selected`, `unit`) is part of the cache key used by
   * `syncAnnotations` — add any new appearance input to both places.
   */
  private buildAnnotation(
    annotation: Annotation,
    colorHex: string,
    selected: boolean,
    unit: string,
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = `annotation-${annotation.id}`;
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

    if (annotation.kind === 'path' && points.length >= 2) {
      points.forEach((p) => group.add(this.makeMarker(p, color, markerScale * 0.8)));
      group.add(
        new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color })),
      );
      const mid = polylineMidpoint(points);
      const value = annotation.distance ?? pathLength(annotation.points);
      group.add(this.makeLabel(`${annotation.label} · ${formatValue(value)} ${unit}`, colorHex, mid, selected));
      return group;
    }

    if (annotation.kind === 'area' && points.length >= 3) {
      points.forEach((p) => group.add(this.makeMarker(p, color, markerScale * 0.8)));
      // WebGPURenderer does not support THREE.LineLoop — use a closed Line instead.
      const outline = new THREE.BufferGeometry().setFromPoints([...points, points[0]]);
      group.add(new THREE.Line(outline, new THREE.LineBasicMaterial({ color })));
      group.add(this.makeAreaFill(points, color, 0.3, true));
      const centroid = points.reduce((acc, p) => acc.add(p), new THREE.Vector3()).divideScalar(points.length);
      group.add(
        this.makeLabel(`${annotation.label} · ${formatValue(annotation.area ?? 0)} ${unit}²`, colorHex, centroid, selected),
      );
    }
    return group;
  }
}
