import type { Point } from '@/lib/cad/types';

export const EPSILON = 1e-9;

export function point(x: number, y: number): Point {
    return { x, y };
}

export function add(a: Point, b: Point): Point {
    return { x: a.x + b.x, y: a.y + b.y };
}

export function subtract(a: Point, b: Point): Point {
    return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Point, factor: number): Point {
    return { x: a.x * factor, y: a.y * factor };
}

export function dot(a: Point, b: Point): number {
    return a.x * b.x + a.y * b.y;
}

export function cross(a: Point, b: Point): number {
    return a.x * b.y - a.y * b.x;
}

export function length(a: Point): number {
    return Math.hypot(a.x, a.y);
}

export function distance(a: Point, b: Point): number {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

export function normalize(a: Point): Point {
    const magnitude = length(a);

    return magnitude < EPSILON
        ? { x: 0, y: 0 }
        : { x: a.x / magnitude, y: a.y / magnitude };
}

/** Rotate 90 degrees counter-clockwise — the "left" normal of a direction. */
export function perpendicular(a: Point): Point {
    return { x: -a.y, y: a.x };
}

export function rotate(
    a: Point,
    radians: number,
    origin: Point = { x: 0, y: 0 },
): Point {
    const sin = Math.sin(radians);
    const cos = Math.cos(radians);
    const dx = a.x - origin.x;
    const dy = a.y - origin.y;

    return {
        x: origin.x + dx * cos - dy * sin,
        y: origin.y + dx * sin + dy * cos,
    };
}

export function lerp(a: Point, b: Point, t: number): Point {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function midpoint(a: Point, b: Point): Point {
    return lerp(a, b, 0.5);
}

export function angleOf(a: Point): number {
    return Math.atan2(a.y, a.x);
}

export function equals(a: Point, b: Point, tolerance = 1): boolean {
    return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

export function roundTo(value: number, step: number): number {
    return step <= 0 ? value : Math.round(value / step) * step;
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

export function radiansToDegrees(radians: number): number {
    return (radians * 180) / Math.PI;
}

export function degreesToRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
}

/**
 * Intersect two infinite lines given as a point and a direction.
 * Returns null when the lines are parallel within tolerance.
 */
export function intersectLines(
    originA: Point,
    directionA: Point,
    originB: Point,
    directionB: Point,
): Point | null {
    const denominator = cross(directionA, directionB);

    if (Math.abs(denominator) < 1e-7) {
        return null;
    }

    const t = cross(subtract(originB, originA), directionB) / denominator;

    return add(originA, scale(directionA, t));
}

export type ProjectionResult = {
    point: Point;
    t: number;
    distance: number;
};

/** Closest point on the segment `a`→`b`, with the clamped parameter. */
export function projectOnSegment(
    p: Point,
    a: Point,
    b: Point,
): ProjectionResult {
    const axis = subtract(b, a);
    const lengthSquared = dot(axis, axis);

    if (lengthSquared < EPSILON) {
        return { point: { ...a }, t: 0, distance: distance(p, a) };
    }

    const t = clamp(dot(subtract(p, a), axis) / lengthSquared, 0, 1);
    const projected = add(a, scale(axis, t));

    return { point: projected, t, distance: distance(p, projected) };
}

/** Intersection of two segments, or null when they do not cross. */
export function intersectSegments(
    a1: Point,
    a2: Point,
    b1: Point,
    b2: Point,
): Point | null {
    const directionA = subtract(a2, a1);
    const directionB = subtract(b2, b1);
    const denominator = cross(directionA, directionB);

    if (Math.abs(denominator) < 1e-7) {
        return null;
    }

    const t = cross(subtract(b1, a1), directionB) / denominator;
    const u = cross(subtract(b1, a1), directionA) / denominator;

    if (t < 0 || t > 1 || u < 0 || u > 1) {
        return null;
    }

    return add(a1, scale(directionA, t));
}

export function polygonArea(points: Point[]): number {
    if (points.length < 3) {
        return 0;
    }

    let total = 0;

    for (let index = 0; index < points.length; index++) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        total += current.x * next.y - next.x * current.y;
    }

    return Math.abs(total) / 2;
}

export function polygonPerimeter(points: Point[]): number {
    let total = 0;

    for (let index = 0; index < points.length; index++) {
        total += distance(points[index], points[(index + 1) % points.length]);
    }

    return total;
}

export function polygonCentroid(points: Point[]): Point {
    if (points.length === 0) {
        return { x: 0, y: 0 };
    }

    let signedArea = 0;
    let cx = 0;
    let cy = 0;

    for (let index = 0; index < points.length; index++) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        const factor = current.x * next.y - next.x * current.y;
        signedArea += factor;
        cx += (current.x + next.x) * factor;
        cy += (current.y + next.y) * factor;
    }

    if (Math.abs(signedArea) < EPSILON) {
        return points.reduce(
            (accumulator, item, _index, all) => ({
                x: accumulator.x + item.x / all.length,
                y: accumulator.y + item.y / all.length,
            }),
            { x: 0, y: 0 },
        );
    }

    signedArea *= 0.5;

    return { x: cx / (6 * signedArea), y: cy / (6 * signedArea) };
}

export function pointInPolygon(p: Point, polygon: Point[]): boolean {
    let inside = false;

    for (
        let index = 0, previous = polygon.length - 1;
        index < polygon.length;
        previous = index++
    ) {
        const current = polygon[index];
        const other = polygon[previous];
        const straddles = current.y > p.y !== other.y > p.y;

        if (
            straddles &&
            p.x <
                ((other.x - current.x) * (p.y - current.y)) /
                    (other.y - current.y) +
                    current.x
        ) {
            inside = !inside;
        }
    }

    return inside;
}

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export function boundsOf(points: Point[]): Bounds | null {
    if (points.length === 0) {
        return null;
    }

    return points.reduce<Bounds>(
        (bounds, item) => ({
            minX: Math.min(bounds.minX, item.x),
            minY: Math.min(bounds.minY, item.y),
            maxX: Math.max(bounds.maxX, item.x),
            maxY: Math.max(bounds.maxY, item.y),
        }),
        { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
}

export function expandBounds(bounds: Bounds, margin: number): Bounds {
    return {
        minX: bounds.minX - margin,
        minY: bounds.minY - margin,
        maxX: bounds.maxX + margin,
        maxY: bounds.maxY + margin,
    };
}

export function boundsCenter(bounds: Bounds): Point {
    return {
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
    };
}

/**
 * Ramer–Douglas–Peucker simplification, used to take the staircase edges of a
 * rasterised room boundary back to straight walls.
 */
export function simplifyPolyline(points: Point[], tolerance: number): Point[] {
    if (points.length < 3) {
        return points;
    }

    let maxDistance = 0;
    let index = 0;

    for (let i = 1; i < points.length - 1; i++) {
        const { distance: deviation } = projectOnSegment(
            points[i],
            points[0],
            points[points.length - 1],
        );

        if (deviation > maxDistance) {
            maxDistance = deviation;
            index = i;
        }
    }

    if (maxDistance <= tolerance) {
        return [points[0], points[points.length - 1]];
    }

    const left = simplifyPolyline(points.slice(0, index + 1), tolerance);
    const right = simplifyPolyline(points.slice(index), tolerance);

    return [...left.slice(0, -1), ...right];
}

/** Drop vertices that sit on the straight line between their neighbours. */
export function removeCollinear(points: Point[], tolerance = 1): Point[] {
    if (points.length < 3) {
        return points;
    }

    const result: Point[] = [];

    for (let index = 0; index < points.length; index++) {
        const previous = points[(index - 1 + points.length) % points.length];
        const current = points[index];
        const next = points[(index + 1) % points.length];
        const area = Math.abs(
            cross(subtract(current, previous), subtract(next, previous)),
        );

        if (area / Math.max(distance(previous, next), EPSILON) > tolerance) {
            result.push(current);
        }
    }

    return result.length >= 3 ? result : points;
}

/**
 * Ear-clipping triangulation for simple polygons, used to fill floor slabs and
 * room surfaces in the 3D view.
 */
export function triangulate(polygon: Point[]): [number, number, number][] {
    const count = polygon.length;

    if (count < 3) {
        return [];
    }

    const indices = [...Array(count).keys()];
    const isCounterClockwise = signedArea(polygon) > 0;

    if (!isCounterClockwise) {
        indices.reverse();
    }

    const triangles: [number, number, number][] = [];
    let guard = 0;

    while (indices.length > 3 && guard++ < count * count) {
        let clipped = false;

        for (let index = 0; index < indices.length; index++) {
            const previous =
                indices[(index - 1 + indices.length) % indices.length];
            const current = indices[index];
            const next = indices[(index + 1) % indices.length];
            const a = polygon[previous];
            const b = polygon[current];
            const c = polygon[next];

            if (cross(subtract(b, a), subtract(c, b)) <= 0) {
                continue;
            }

            const containsOther = indices.some(
                (candidate) =>
                    candidate !== previous &&
                    candidate !== current &&
                    candidate !== next &&
                    pointInTriangle(polygon[candidate], a, b, c),
            );

            if (containsOther) {
                continue;
            }

            triangles.push([previous, current, next]);
            indices.splice(index, 1);
            clipped = true;
            break;
        }

        if (!clipped) {
            break;
        }
    }

    if (indices.length === 3) {
        triangles.push([indices[0], indices[1], indices[2]]);
    }

    return triangles;
}

/** Signed area of a polygon: positive when the winding is counter-clockwise. */
export function signedArea(points: Point[]): number {
    let total = 0;

    for (let index = 0; index < points.length; index++) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        total += current.x * next.y - next.x * current.y;
    }

    return total / 2;
}

function pointInTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
    const d1 = cross(subtract(b, a), subtract(p, a));
    const d2 = cross(subtract(c, b), subtract(p, b));
    const d3 = cross(subtract(a, c), subtract(p, c));
    const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;

    return !(hasNegative && hasPositive);
}
