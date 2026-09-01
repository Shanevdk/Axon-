import { describe, expect, it } from 'vitest';
import {
    BRICK_LENGTH,
    COURSE_HEIGHT,
    grainLines,
    MAX_LINES,
    WOOD_SPACING,
} from '@/lib/cad/grain';
import type { GrainSegment } from '@/lib/cad/grain';
import type { Vec3 } from '@/lib/cad/solids';

/** A wall face standing on the ground, running east, facing south. */
function wallFace(length = 3000, height = 2400, at: Vec3 = { x: 0, y: 0, z: 0 }): Vec3[] {
    return [
        { x: at.x, y: at.y, z: at.z },
        { x: at.x + length, y: at.y, z: at.z },
        { x: at.x + length, y: at.y, z: at.z + height },
        { x: at.x, y: at.y, z: at.z + height },
    ];
}

function points(lines: GrainSegment[]): Vec3[] {
    return lines.flat();
}

describe('grain lies on the face it marks', () => {
    it('keeps every line in the plane of the wall', () => {
        const face = wallFace();

        // The wall stands at y = 0, so anything drawn on it does too. A line
        // that drifts off the plane is a line floating in the room.
        points(grainLines(face, 'wood')).forEach((point) => {
            expect(point.y).toBeCloseTo(0, 6);
        });
    });

    it('keeps every line inside the face', () => {
        const face = wallFace();

        points(grainLines(face, 'wood')).forEach((point) => {
            expect(point.x).toBeGreaterThanOrEqual(-0.001);
            expect(point.x).toBeLessThanOrEqual(3000.001);
            expect(point.z).toBeGreaterThanOrEqual(-0.001);
            expect(point.z).toBeLessThanOrEqual(2400.001);
        });
    });

    it('travels with the house when the house moves', () => {
        // The whole point: the marks belong to the building, not to the
        // screen. Move the wall and its grain goes with it, unchanged.
        const here = grainLines(wallFace(), 'wood');
        const there = grainLines(
            wallFace(3000, 2400, { x: 12_000, y: 5000, z: 0 }),
            'wood',
        );

        expect(there).toHaveLength(here.length);

        here.forEach((line, index) => {
            line.forEach((point, end) => {
                expect(there[index][end].x).toBeCloseTo(point.x + 12_000, 6);
                expect(there[index][end].y).toBeCloseTo(point.y + 5000, 6);
                expect(there[index][end].z).toBeCloseTo(point.z, 6);
            });
        });
    });

    it('marks a wall running the other way just as densely', () => {
        // Same wall, turned to run north. Nothing about the marking should
        // care which way round it is.
        const east = grainLines(wallFace(), 'wood');
        const north = grainLines(
            [
                { x: 0, y: 0, z: 0 },
                { x: 0, y: 3000, z: 0 },
                { x: 0, y: 3000, z: 2400 },
                { x: 0, y: 0, z: 2400 },
            ],
            'wood',
        );

        expect(north).toHaveLength(east.length);
    });
});

describe('wood', () => {
    it('spaces the grain in millimetres, not pixels', () => {
        const heights = grainLines(wallFace(3000, 1100), 'wood')
            .map(([from]) => from.z)
            .sort((a, b) => a - b);

        expect(heights.length).toBeGreaterThan(1);

        // A real distance on the building, so it holds however the model is
        // drawn or wherever the camera is.
        for (let index = 1; index < heights.length; index++) {
            expect(heights[index] - heights[index - 1]).toBeCloseTo(
                WOOD_SPACING,
                6,
            );
        }
    });

    it('gives twice the wall twice the grain', () => {
        const short = grainLines(wallFace(3000, 550), 'wood');
        const tall = grainLines(wallFace(3000, 1100), 'wood');

        expect(tall.length).toBeGreaterThanOrEqual(short.length * 2 - 1);
    });

    it('never draws a line along the edge of the face', () => {
        // A line on the boundary is not a mark on the surface, it is the
        // face's own outline drawn twice.
        grainLines(wallFace(3000, 1100), 'wood').forEach(([from]) => {
            expect(from.z).toBeGreaterThan(0.001);
            expect(from.z).toBeLessThan(1099.999);
        });
    });

    it('runs the grain the long way, as a member is sawn', () => {
        grainLines(wallFace(3000, 550), 'wood').forEach(([from, to]) => {
            // Along the wall, and level with itself.
            expect(Math.abs(to.x - from.x)).toBeCloseTo(3000, 3);
            expect(to.z).toBeCloseTo(from.z, 6);
        });
    });

    it('leaves a member too small to show grain unmarked', () => {
        expect(grainLines(wallFace(3000, 40), 'wood')).toEqual([]);
    });

    it('does not mark a material that has no grain', () => {
        expect(grainLines(wallFace(), 'concrete')).toEqual([]);
        expect(grainLines(wallFace(), 'glass')).toEqual([]);
    });
});

describe('masonry', () => {
    const courses = (face: Vec3[]) =>
        grainLines(face, 'masonry').filter(
            ([from, to]) => Math.abs(to.z - from.z) < 0.001,
        );

    const perpends = (face: Vec3[]) =>
        grainLines(face, 'masonry').filter(
            ([from, to]) => Math.abs(to.z - from.z) >= 0.001,
        );

    it('lays the courses level', () => {
        // A bricklayer works to a level, whatever the wall is doing.
        courses(wallFace()).forEach(([from, to]) => {
            expect(from.z).toBeCloseTo(to.z, 6);
        });
    });

    it('spaces the courses a brick and a joint apart', () => {
        const heights = courses(wallFace(3000, 860))
            .map(([from]) => from.z)
            .sort((a, b) => a - b);

        expect(heights.length).toBeGreaterThan(1);

        for (let index = 1; index < heights.length; index++) {
            expect(heights[index] - heights[index - 1]).toBeCloseTo(
                COURSE_HEIGHT,
                6,
            );
        }
    });

    it('staggers the perpends into a bond rather than a stack', () => {
        const marks = perpends(wallFace(2000, 400));

        const lowest = Math.min(...marks.map(([from]) => from.z));

        const bottomRow = marks
            .filter(([from]) => Math.abs(from.z - lowest) < 0.001)
            .map(([from]) => from.x);
        const nextRow = marks
            .filter(
                ([from]) =>
                    Math.abs(from.z - (lowest + COURSE_HEIGHT)) < 0.001,
            )
            .map(([from]) => from.x);

        expect(bottomRow.length).toBeGreaterThan(0);
        expect(nextRow.length).toBeGreaterThan(0);

        // Every perpend in one row sits half a brick off every one below it.
        nextRow.forEach((x) => {
            bottomRow.forEach((below) => {
                const gap = Math.abs(((x - below) % BRICK_LENGTH) + 0);

                expect(Math.min(gap, BRICK_LENGTH - gap)).toBeCloseTo(
                    BRICK_LENGTH / 2,
                    3,
                );
            });
        });
    });

    it('runs the perpends up the wall', () => {
        perpends(wallFace()).forEach(([from, to]) => {
            expect(from.x).toBeCloseTo(to.x, 6);
        });
    });
});

describe('what it refuses to draw', () => {
    it('gives up on a face with no plane to lie in', () => {
        expect(
            grainLines(
                [
                    { x: 0, y: 0, z: 0 },
                    { x: 1000, y: 0, z: 0 },
                    { x: 2000, y: 0, z: 0 },
                ],
                'wood',
            ),
        ).toEqual([]);
    });

    it('gives up on something that is not a face', () => {
        expect(grainLines([{ x: 0, y: 0, z: 0 }], 'wood')).toEqual([]);
    });

    it('stops before a wall of hairlines', () => {
        // A tower block's worth of face still gets a readable number of marks.
        const lines = grainLines(wallFace(200_000, 200_000), 'wood');

        expect(lines.length).toBeLessThanOrEqual(MAX_LINES);
    });
});
