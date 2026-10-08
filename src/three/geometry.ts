import * as THREE from 'three';

/** Refinement limits for surface-conforming area fills. */
export const MAX_AREA_SUBDIVISION_PASSES = 4;
export const MAX_AREA_VERTICES = 2000;

/**
 * Newell's method: a robust normal for a (possibly non-planar) outline. Returns
 * null for degenerate outlines (collinear or duplicate points).
 */
export function outlineNormal(points: THREE.Vector3[]): THREE.Vector3 | null {
  const normal = new THREE.Vector3();
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    normal.x += (current.y - next.y) * (current.z + next.z);
    normal.y += (current.z - next.z) * (current.x + next.x);
    normal.z += (current.x - next.x) * (current.y + next.y);
  }
  return normal.lengthSq() > 1e-20 ? normal.normalize() : null;
}

/** Orthonormal basis (u, v) spanning the plane perpendicular to `n`. */
export function planeBasis(n: THREE.Vector3): { u: THREE.Vector3; v: THREE.Vector3 } {
  const helper = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(helper, n).normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  return { u, v };
}

/**
 * Uniform midpoint subdivision of an indexed planar triangulation: every triangle
 * with an edge longer than `maxEdge` is split into four (three corner triangles
 * plus the center one), giving the fill interior vertices dense enough to follow
 * a curved surface once projected back onto it.
 */
export function subdividePlanarTriangles(
  flat: THREE.Vector2[],
  triangles: number[][],
  maxEdge: number,
): { positions: THREE.Vector2[]; indices: number[] } {
  const positions = flat.map((p) => p.clone());
  let tris = triangles.map(([a, b, c]) => [a, b, c]);
  const midpoints = new Map<string, number>();

  const midpointOf = (a: number, b: number): number => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const cached = midpoints.get(key);
    if (cached !== undefined) return cached;
    const index = positions.push(positions[a].clone().add(positions[b]).multiplyScalar(0.5)) - 1;
    midpoints.set(key, index);
    return index;
  };

  for (let pass = 0; pass < MAX_AREA_SUBDIVISION_PASSES; pass++) {
    if (positions.length > MAX_AREA_VERTICES) break;
    let split = false;
    const next: number[][] = [];
    for (const [a, b, c] of tris) {
      const edges: Array<[number, number]> = [
        [a, b],
        [b, c],
        [c, a],
      ];
      if (!edges.some(([i, j]) => positions[i].distanceTo(positions[j]) > maxEdge)) {
        next.push([a, b, c]);
        continue;
      }
      const ab = midpointOf(a, b);
      const bc = midpointOf(b, c);
      const ca = midpointOf(c, a);
      // All four sub-triangles: three corners and the center. Omitting the center
      // leaves a hole in every refined triangle.
      next.push([a, ab, ca], [ab, b, bc], [ab, bc, ca], [ca, bc, c]);
      split = true;
    }
    tris = next;
    if (!split) break;
  }

  const indices: number[] = [];
  for (const [a, b, c] of tris) indices.push(a, b, c);
  return { positions, indices };
}
