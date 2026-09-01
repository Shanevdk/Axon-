/**
 * Grain and coursing, drawn on the building rather than on the glass.
 *
 * The marks a surface carries belong to the surface. Boards are sawn along
 * the member and bricks are laid level, and neither of those has anything to
 * do with where the camera happens to be — so the lines are worked out here,
 * in millimetres, in the plane of the face itself. The renderer's only job is
 * to project them.
 *
 * Doing it the other way round — laying lines over the projected outline, at
 * a spacing in pixels — is why grain used to swim across a wall as the model
 * turned, and flip from horizontal to vertical as a face passed through
 * square on.
 */

import { faceNormal } from '@/lib/cad/solids';
import type { Vec3 } from '@/lib/cad/solids';
import { MATERIAL_GRAIN } from '@/lib/cad/theme';

/** A grain line, in model space. */
export type GrainSegment = [Vec3, Vec3];

/** Millimetres between grain lines along a sawn member. */
export const WOOD_SPACING = 55;

/** A brick course, in millimetres: brick plus its bed joint. */
export const COURSE_HEIGHT = 86;

/** A brick and its perpend, so the stagger lands where a header would. */
export const BRICK_LENGTH = 215;

/**
 * No face carries more than this many lines in one direction. A gable wall
 * at 4 m is 46 courses, and past that the lines are closer than the eye
 * separates anyway.
 */
export const MAX_LINES = 48;

/**
 * The marks on one face, in model space.
 *
 * Returns an empty list for a material that carries no marking, for a face
 * too small to show any, and for a degenerate face with no plane to lie in.
 */
export function grainLines(face: Vec3[], material: string): GrainSegment[] {
    const grain = MATERIAL_GRAIN[material];

    if (!grain || face.length < 3) {
        return [];
    }

    const basis = planeBasis(face, grain);

    if (!basis) {
        return [];
    }

    const { origin, along, up } = basis;

    const flat = face.map((vertex) => ({
        a: dot(subtract(vertex, origin), along),
        b: dot(subtract(vertex, origin), up),
    }));

    const minA = Math.min(...flat.map((point) => point.a));
    const maxA = Math.max(...flat.map((point) => point.a));
    const minB = Math.min(...flat.map((point) => point.b));
    const maxB = Math.max(...flat.map((point) => point.b));

    // Back into the world: a point in the face's own plane.
    const at = (a: number, b: number): Vec3 => ({
        x: origin.x + along.x * a + up.x * b,
        y: origin.y + along.y * a + up.y * b,
        z: origin.z + along.z * a + up.z * b,
    });

    return grain === 'wood'
        ? woodGrain(at, minA, maxA, minB, maxB)
        : coursing(at, minA, maxA, minB, maxB);
}

/**
 * Lines the length of the member, spaced across it.
 *
 * Anchored to the face's own origin rather than to its lower bound, so two
 * faces of the same member line up instead of each starting its own count.
 */
function woodGrain(
    at: (a: number, b: number) => Vec3,
    minA: number,
    maxA: number,
    minB: number,
    maxB: number,
): GrainSegment[] {
    return interior(minB, maxB, WOOD_SPACING).map(
        (b): GrainSegment => [at(minA, b), at(maxA, b)],
    );
}

/**
 * The multiples of `spacing` strictly inside a range.
 *
 * Strictly, because a line landing exactly on the edge of the face would be
 * drawn on top of the face's own outline — a doubled edge rather than a mark
 * on the surface. Counted from zero rather than from the start of the range,
 * so neighbouring faces of the same wall agree on where the lines fall
 * instead of each starting its own tally.
 */
function interior(min: number, max: number, spacing: number): number[] {
    const first = Math.floor(min / spacing) + 1;
    const last = Math.ceil(max / spacing) - 1;

    const steps: number[] = [];

    for (let step = first; step <= last && steps.length < MAX_LINES; step++) {
        steps.push(step * spacing);
    }

    return steps;
}

/** Level beds, with the perpends staggered half a brick every other course. */
function coursing(
    at: (a: number, b: number) => Vec3,
    minA: number,
    maxA: number,
    minB: number,
    maxB: number,
): GrainSegment[] {
    const beds = interior(minB, maxB, COURSE_HEIGHT).map(
        (b): GrainSegment => [at(minA, b), at(maxA, b)],
    );

    const perpends: GrainSegment[] = [];

    const firstCourse = Math.floor(minB / COURSE_HEIGHT);
    const lastCourse = Math.ceil(maxB / COURSE_HEIGHT) - 1;

    for (
        let course = firstCourse;
        course <= lastCourse && perpends.length < MAX_LINES;
        course++
    ) {
        const bottom = Math.max(course * COURSE_HEIGHT, minB);
        const top = Math.min((course + 1) * COURSE_HEIGHT, maxB);

        if (top - bottom < 1) {
            continue;
        }

        // Every other course starts half a brick over, which is what makes it
        // a bond rather than a stack.
        const offset =
            Math.abs(course % 2) === 0 ? 0 : BRICK_LENGTH / 2;

        for (const a of interior(minA - offset, maxA - offset, BRICK_LENGTH)) {
            if (perpends.length >= MAX_LINES) {
                break;
            }

            perpends.push([at(a + offset, bottom), at(a + offset, top)]);
        }
    }

    return [...beds, ...perpends];
}

/**
 * Two directions in the plane of the face: one to run the lines along, one
 * to space them across.
 *
 * Timber follows the longest edge, which is the way a member is cut. Masonry
 * follows the level, because a bricklayer does — so its `along` is whichever
 * in-plane direction is horizontal in the world, and it falls back to the
 * longest edge on a face lying flat, where nothing is more level than
 * anything else.
 */
function planeBasis(
    face: Vec3[],
    grain: 'wood' | 'masonry',
): { origin: Vec3; along: Vec3; up: Vec3 } | null {
    const normal = faceNormal(face);

    if (Math.hypot(normal.x, normal.y, normal.z) < 0.5) {
        return null;
    }

    const level = cross({ x: 0, y: 0, z: 1 }, normal);
    const levelled = Math.hypot(level.x, level.y, level.z) > 1e-6;

    const preferred =
        grain === 'masonry' && levelled ? level : longestEdge(face);

    // Square the direction against the normal, so a rounding error in the
    // edge does not tilt the lines out of the face.
    const along = normalize(
        subtract(preferred, scale(normal, dot(preferred, normal))),
    );

    if (along === null) {
        return null;
    }

    return { origin: face[0], along, up: cross(normal, along) };
}

function longestEdge(face: Vec3[]): Vec3 {
    let longest = subtract(face[1], face[0]);
    let best = -1;

    for (let index = 0; index < face.length; index++) {
        const edge = subtract(face[(index + 1) % face.length], face[index]);
        const length = Math.hypot(edge.x, edge.y, edge.z);

        if (length > best) {
            best = length;
            longest = edge;
        }
    }

    return longest;
}

function subtract(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(a: Vec3, by: number): Vec3 {
    return { x: a.x * by, y: a.y * by, z: a.z * by };
}

function dot(a: Vec3, b: Vec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

function normalize(a: Vec3): Vec3 | null {
    const magnitude = Math.hypot(a.x, a.y, a.z);

    return magnitude < 1e-9 ? null : scale(a, 1 / magnitude);
}
