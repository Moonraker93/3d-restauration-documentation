import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  MAX_AREA_SUBDIVISION_PASSES,
  MAX_AREA_VERTICES,
  outlineNormal,
  planeBasis,
  subdividePlanarTriangles,
} from './geometry';

const V = (x: number, y: number): THREE.Vector2 => new THREE.Vector2(x, y);
const P = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

function triangleArea(a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2): number {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
}

/** Total area covered by an indexed planar triangulation. */
function coveredArea(positions: THREE.Vector2[], indices: number[]): number {
  let sum = 0;
  for (let i = 0; i < indices.length; i += 3) {
    sum += triangleArea(positions[indices[i]], positions[indices[i + 1]], positions[indices[i + 2]]);
  }
  return sum;
}

function degenerateTriangles(positions: THREE.Vector2[], indices: number[]): number {
  let count = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const area = triangleArea(positions[indices[i]], positions[indices[i + 1]], positions[indices[i + 2]]);
    if (area <= 1e-12) count++;
  }
  return count;
}

describe('subdividePlanarTriangles', () => {
  it('leaves a triangle untouched when every edge is short enough', () => {
    const flat = [V(0, 0), V(1, 0), V(0, 1)];
    const { positions, indices } = subdividePlanarTriangles(flat, [[0, 1, 2]], 10);
    expect(positions).toHaveLength(3);
    expect(indices).toEqual([0, 1, 2]);
  });

  it('keeps the covered area when refining a triangle (no missing center triangle)', () => {
    const flat = [V(0, 0), V(1, 0), V(0, 1)];
    const { positions, indices } = subdividePlanarTriangles(flat, [[0, 1, 2]], 0.1);
    expect(indices.length / 3).toBeGreaterThan(1);
    expect(coveredArea(positions, indices)).toBeCloseTo(0.5, 10);
  });

  it('keeps the covered area for a two-triangle quad', () => {
    const flat = [V(0, 0), V(1, 0), V(1, 1), V(0, 1)];
    const { positions, indices } = subdividePlanarTriangles(flat, [[0, 1, 2], [0, 2, 3]], 0.2);
    expect(coveredArea(positions, indices)).toBeCloseTo(1, 10);
  });

  it('produces no degenerate triangles', () => {
    const flat = [V(0, 0), V(1, 0), V(1, 1), V(0, 1)];
    const { positions, indices } = subdividePlanarTriangles(flat, [[0, 1, 2], [0, 2, 3]], 0.1);
    expect(degenerateTriangles(positions, indices)).toBe(0);
  });

  it('terminates within the pass and vertex budgets for a tiny maxEdge', () => {
    const flat = [V(0, 0), V(1, 0), V(0, 1)];
    const { positions, indices } = subdividePlanarTriangles(flat, [[0, 1, 2]], 1e-6);
    expect(positions.length).toBeLessThanOrEqual(MAX_AREA_VERTICES * 4);
    expect(indices.length / 3).toBeLessThanOrEqual(4 ** MAX_AREA_SUBDIVISION_PASSES);
    // Refinement is bounded, but the surface must still be fully covered.
    expect(coveredArea(positions, indices)).toBeCloseTo(0.5, 10);
  });

  it('keeps every generated vertex inside the source triangle', () => {
    const flat = [V(0, 0), V(1, 0), V(0, 1)];
    const { positions } = subdividePlanarTriangles(flat, [[0, 1, 2]], 1e-3);
    for (const p of positions) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-9);
      expect(p.y).toBeGreaterThanOrEqual(-1e-9);
      expect(p.x + p.y).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe('outlineNormal', () => {
  it('returns the unit normal of a planar outline', () => {
    const n = outlineNormal([P(0, 0, 0), P(1, 0, 0), P(1, 1, 0), P(0, 1, 0)]);
    expect(n).not.toBeNull();
    expect(n!.length()).toBeCloseTo(1, 10);
    expect(n!.z).toBeCloseTo(1, 10);
  });

  it('flips with the winding order', () => {
    const n = outlineNormal([P(0, 0, 0), P(0, 1, 0), P(1, 1, 0), P(1, 0, 0)]);
    expect(n!.z).toBeCloseTo(-1, 10);
  });

  it('returns null for degenerate outlines', () => {
    expect(outlineNormal([P(0, 0, 0), P(1, 0, 0), P(2, 0, 0)])).toBeNull();
    expect(outlineNormal([P(1, 1, 1), P(1, 1, 1), P(1, 1, 1)])).toBeNull();
  });

  it('is perpendicular to a tilted outline', () => {
    const n = P(1, 1, 1).normalize();
    const { u, v } = planeBasis(n);
    const origin = P(0, 0, 0);
    const outline = [origin, u.clone(), u.clone().add(v), v.clone()];
    const normal = outlineNormal(outline);
    expect(normal).not.toBeNull();
    expect(Math.abs(normal!.dot(n))).toBeCloseTo(1, 10);
  });
});

describe('planeBasis', () => {
  it('is orthonormal for an axis-aligned normal', () => {
    const n = P(0, 0, 1);
    const { u, v } = planeBasis(n);
    expect(u.length()).toBeCloseTo(1, 10);
    expect(v.length()).toBeCloseTo(1, 10);
    expect(u.dot(v)).toBeCloseTo(0, 10);
    expect(u.dot(n)).toBeCloseTo(0, 10);
    expect(v.dot(n)).toBeCloseTo(0, 10);
  });

  it('is orthonormal when the normal is mostly along Y (alternate helper branch)', () => {
    const n = P(0, 1, 0);
    const { u, v } = planeBasis(n);
    expect(u.length()).toBeCloseTo(1, 10);
    expect(v.length()).toBeCloseTo(1, 10);
    expect(u.dot(v)).toBeCloseTo(0, 10);
    expect(u.dot(n)).toBeCloseTo(0, 10);
    expect(v.dot(n)).toBeCloseTo(0, 10);
  });

  it('spans the plane for a tilted normal', () => {
    const n = P(1, 1, 1).normalize();
    const { u, v } = planeBasis(n);
    expect(u.dot(n)).toBeCloseTo(0, 10);
    expect(v.dot(n)).toBeCloseTo(0, 10);
    expect(new THREE.Vector3().crossVectors(u, v).dot(n)).toBeCloseTo(1, 10);
  });
});
