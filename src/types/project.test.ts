import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYERS,
  PROJECT_EXTENSION,
  PROJECT_VERSION,
  distance3D,
  formatValue,
  kindName,
  pathLength,
  polygonArea3D,
  uid,
  withPoints,
  type Annotation,
  type AnnotationKind,
  type Vec3Tuple,
} from './project';

const P = (x: number, y: number, z: number): Vec3Tuple => [x, y, z];

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1',
    layerId: 'l1',
    kind: 'point',
    label: 'Note 1',
    notes: '',
    points: [P(0, 0, 0)],
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('constants', () => {
  it('exposes the project version and file extension', () => {
    expect(PROJECT_VERSION).toBe(1);
    expect(PROJECT_EXTENSION).toBe('.a3d');
  });

  it('defines the default damage layers (without ids)', () => {
    expect(DEFAULT_LAYERS).toHaveLength(5);
    for (const layer of DEFAULT_LAYERS) {
      expect(layer.name).toBeTruthy();
      expect(layer.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(layer.visible).toBe(true);
      expect(layer).not.toHaveProperty('id');
    }
    expect(DEFAULT_LAYERS.map((l) => l.name)).toContain('Cracks');
  });
});

describe('distance3D', () => {
  it('is zero for identical points', () => {
    expect(distance3D(P(1, 2, 3), P(1, 2, 3))).toBe(0);
  });

  it('returns the Euclidean distance of a 3-4-5 triangle', () => {
    expect(distance3D(P(0, 0, 0), P(3, 4, 0))).toBe(5);
  });

  it('handles negative coordinates and all three axes', () => {
    expect(distance3D(P(-1, -1, -1), P(1, 1, 1))).toBeCloseTo(Math.sqrt(12), 12);
  });

  it('is symmetric', () => {
    const a = P(1.5, -2.25, 0.75);
    const b = P(-3, 4, 9);
    expect(distance3D(a, b)).toBeCloseTo(distance3D(b, a), 12);
  });
});

describe('pathLength', () => {
  it('is zero for empty and single-point paths', () => {
    expect(pathLength([])).toBe(0);
    expect(pathLength([P(4, 5, 6)])).toBe(0);
  });

  it('matches distance3D for a single segment', () => {
    expect(pathLength([P(0, 0, 0), P(3, 4, 0)])).toBe(distance3D(P(0, 0, 0), P(3, 4, 0)));
  });

  it('sums all segments of an open polyline', () => {
    // 3 + 4 + 12 = 19
    expect(pathLength([P(0, 0, 0), P(3, 0, 0), P(3, 4, 0), P(3, 4, 12)])).toBeCloseTo(19, 12);
  });
});

describe('polygonArea3D', () => {
  it('is zero when fewer than three points are given', () => {
    expect(polygonArea3D([])).toBe(0);
    expect(polygonArea3D([P(0, 0, 0)])).toBe(0);
    expect(polygonArea3D([P(0, 0, 0), P(1, 0, 0)])).toBe(0);
  });

  it('computes the area of a planar right triangle', () => {
    expect(polygonArea3D([P(0, 0, 0), P(2, 0, 0), P(0, 3, 0)])).toBeCloseTo(3, 12);
  });

  it('computes the area of a unit square', () => {
    expect(polygonArea3D([P(0, 0, 0), P(1, 0, 0), P(1, 1, 0), P(0, 1, 0)])).toBeCloseTo(1, 12);
  });

  it('approximates non-planar outlines as a triangle fan', () => {
    // (0,0,0)-(1,0,0)-(1,1,1) and (0,0,0)-(1,1,1)-(0,1,0) each have area sqrt(2)/2.
    const area = polygonArea3D([P(0, 0, 0), P(1, 0, 0), P(1, 1, 1), P(0, 1, 0)]);
    expect(area).toBeCloseTo(Math.sqrt(2), 12);
  });
});

describe('withPoints', () => {
  it('recomputes distance for measurements', () => {
    const annotation = makeAnnotation({ kind: 'measure', points: [P(0, 0, 0), P(3, 4, 0)] });
    const next = withPoints(annotation, [P(0, 0, 0), P(0, 0, 5)]);
    expect(next.distance).toBe(5);
    expect(next.points).toEqual([P(0, 0, 0), P(0, 0, 5)]);
  });

  it('recomputes polyline length for paths', () => {
    const annotation = makeAnnotation({ kind: 'path', points: [P(0, 0, 0), P(1, 0, 0)] });
    const next = withPoints(annotation, [P(0, 0, 0), P(3, 0, 0), P(3, 4, 0)]);
    // 3 + 4 = 7
    expect(next.distance).toBeCloseTo(7, 12);
  });

  it('recomputes area for areas', () => {
    const annotation = makeAnnotation({ kind: 'area', points: [P(0, 0, 0), P(1, 0, 0), P(0, 1, 0)] });
    const next = withPoints(annotation, [P(0, 0, 0), P(4, 0, 0), P(0, 1, 0)]);
    expect(next.area).toBeCloseTo(2, 12);
  });

  it('leaves note annotations and their fields untouched', () => {
    const annotation = makeAnnotation({ kind: 'point', points: [P(1, 1, 1)] });
    const next = withPoints(annotation, [P(2, 2, 2)]);
    expect(next.distance).toBeUndefined();
    expect(next.area).toBeUndefined();
    expect(next.id).toBe(annotation.id);
    expect(next.label).toBe(annotation.label);
    expect(next.notes).toBe(annotation.notes);
    expect(next.createdAt).toBe(annotation.createdAt);
  });

  it('does not mutate the source annotation (immutability)', () => {
    const points: Vec3Tuple[] = [P(0, 0, 0), P(1, 0, 0)];
    const annotation = makeAnnotation({ kind: 'measure', points, distance: 1 });
    withPoints(annotation, [P(0, 0, 0), P(10, 0, 0)]);
    expect(annotation.points).toBe(points);
    expect(annotation.points).toEqual([P(0, 0, 0), P(1, 0, 0)]);
    expect(annotation.distance).toBe(1);
  });

  it('skips derived values when there are too few points', () => {
    const annotation = makeAnnotation({ kind: 'measure', points: [P(0, 0, 0)] });
    const next = withPoints(annotation, [P(0, 0, 0)]);
    expect(next.distance).toBeUndefined();
  });
});

describe('formatValue', () => {
  it('renders non-finite values as an em dash', () => {
    expect(formatValue(Number.NaN)).toBe('—');
    expect(formatValue(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatValue(Number.NEGATIVE_INFINITY)).toBe('—');
  });

  it('renders zero (and negative zero) as "0"', () => {
    expect(formatValue(0)).toBe('0');
    expect(formatValue(-0)).toBe('0');
  });

  it('uses one decimal for magnitudes >= 100', () => {
    expect(formatValue(123.456)).toBe('123.5');
    expect(formatValue(100)).toBe('100.0');
    expect(formatValue(-250.04)).toBe('-250.0');
  });

  it('uses three decimals for magnitudes >= 1', () => {
    expect(formatValue(1)).toBe('1.000');
    expect(formatValue(1.2345674)).toBe('1.235');
    expect(formatValue(99.9)).toBe('99.900');
  });

  it('uses three significant digits for small magnitudes', () => {
    expect(formatValue(0.0001234)).toBe('0.000123');
    expect(formatValue(-0.5)).toBe('-0.500');
  });
});

describe('kindName', () => {
  it('maps every annotation kind to its display name', () => {
    const expected: Record<AnnotationKind, string> = {
      point: 'Note',
      measure: 'Measurement',
      path: 'Path',
      area: 'Area',
    };
    for (const [kind, name] of Object.entries(expected) as Array<[AnnotationKind, string]>) {
      expect(kindName(kind)).toBe(name);
    }
  });
});

describe('uid', () => {
  it('returns unique strings', () => {
    const ids = new Set(Array.from({ length: 100 }, () => uid()));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(typeof id).toBe('string');
  });
});
