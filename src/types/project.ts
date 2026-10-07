export type Vec3Tuple = [number, number, number];

export type Tool = 'navigate' | 'measure' | 'path' | 'area' | 'annotate';
export type AnnotationKind = 'point' | 'measure' | 'path' | 'area';

export interface DamageLayer {
  id: string;
  name: string;
  color: string;
  visible: boolean;
}

export interface Annotation {
  id: string;
  layerId: string;
  kind: AnnotationKind;
  label: string;
  notes: string;
  /** Per-annotation visibility; missing (older projects) means visible. */
  hidden?: boolean;
  /** Points in model coordinates. point: 1, measure: 2, path: 2+, area: 3+ */
  points: Vec3Tuple[];
  /** Cached derived value for kind === 'measure' (straight-line) or 'path' (polyline length), in model units. */
  distance?: number;
  /** Cached derived value for kind === 'area' (square model units). */
  area?: number;
  createdAt: string;
}

export interface ProjectData {
  version: 1;
  name: string;
  unit: string;
  createdAt: string;
  /** Original file name of the packaged model (inside model/ in the .a3d zip). */
  modelFile: string | null;
  layers: DamageLayer[];
  annotations: Annotation[];
}

export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = '.a3d';

export const DEFAULT_LAYERS: Array<Omit<DamageLayer, 'id'>> = [
  { name: 'Cracks', color: '#ef4444', visible: true },
  { name: 'Material loss', color: '#f97316', visible: true },
  { name: 'Discoloration', color: '#eab308', visible: true },
  { name: 'Previous restoration', color: '#3b82f6', visible: true },
  { name: 'General notes', color: '#9ca3af', visible: true },
];

/** Rotating palette used when the user adds new layers. */
export const LAYER_COLOR_PALETTE = [
  '#22c55e', '#a855f7', '#ec4899', '#14b8a6', '#f43f5e',
  '#84cc16', '#6366f1', '#d946ef', '#0ea5e9', '#facc15',
];

export function uid(): string {
  return crypto.randomUUID();
}

export function distance3D(a: Vec3Tuple, b: Vec3Tuple): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Total length of the open polyline through `points` (model units). */
export function pathLength(points: Vec3Tuple[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance3D(points[i - 1], points[i]);
  return total;
}

/**
 * Surface-patch approximation of the region outlined by `points`:
 * area of the triangle fan (p0, pi, pi+1). Works for non-planar outlines.
 */
export function polygonArea3D(points: Vec3Tuple[]): number {
  if (points.length < 3) return 0;
  const [x0, y0, z0] = points[0];
  let area = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const ux = points[i][0] - x0;
    const uy = points[i][1] - y0;
    const uz = points[i][2] - z0;
    const vx = points[i + 1][0] - x0;
    const vy = points[i + 1][1] - y0;
    const vz = points[i + 1][2] - z0;
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    area += 0.5 * Math.hypot(cx, cy, cz);
  }
  return area;
}

/** Returns `annotation` with new points and its cached distance/area recomputed. */
export function withPoints(annotation: Annotation, points: Vec3Tuple[]): Annotation {
  const next: Annotation = { ...annotation, points };
  if (annotation.kind === 'measure' && points.length >= 2) next.distance = distance3D(points[0], points[1]);
  if (annotation.kind === 'path' && points.length >= 2) next.distance = pathLength(points);
  if (annotation.kind === 'area') next.area = polygonArea3D(points);
  return next;
}

export function formatValue(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs === 0) return '0';
  if (abs >= 100) return value.toFixed(1);
  if (abs >= 1) return value.toFixed(3);
  return value.toPrecision(3);
}

export function kindName(kind: AnnotationKind): string {
  switch (kind) {
    case 'measure': return 'Measurement';
    case 'path': return 'Path';
    case 'area': return 'Area';
    case 'point': return 'Note';
  }
}
