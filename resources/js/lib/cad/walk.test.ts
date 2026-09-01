import { describe, expect, it } from 'vitest';
import { testDocument } from '@/lib/cad/__fixtures__/document';
import {
    EYE_HEIGHT,
    SHOULDER,
    slideAlongWalls,
    startingPose,
    stepWalker,
    wallBarriers,
} from '@/lib/cad/walk';

/*
 * The fixture is a 6 × 4 m shell of 300 walls with a 100 partition down the
 * middle at x = 3000, a 900 door centred on it at y = 2000, and a window in
 * the south wall. Every distance below is millimetres.
 */

const document = testDocument();
const barriers = wallBarriers(document, 'level-1');

describe('wallBarriers', () => {
    it('takes half the thickness from the wall type', () => {
        const partition = barriers.find((barrier) => barrier.half === 50);

        expect(partition).toBeDefined();
        expect(barriers.filter((barrier) => barrier.half === 150)).toHaveLength(
            4,
        );
    });

    it('opens a doorway the width of the door', () => {
        const partition = barriers.find((barrier) => barrier.half === 50)!;

        expect(partition.gaps).toEqual([{ from: 1550, to: 2450 }]);
    });

    it('does not open a gap for a window', () => {
        // The window sits on shell-1, the south wall. A window is glass in a
        // wall, not a way through it.
        const south = barriers.find(
            (barrier) => barrier.a.y === 0 && barrier.b.y === 0,
        )!;

        expect(south.gaps).toEqual([]);
    });

    it('reads only the level it was asked for', () => {
        expect(wallBarriers(document, 'level-2')).toEqual([]);
    });
});

describe('slideAlongWalls', () => {
    it('stops a walker at the face of a wall', () => {
        // Aiming at x = 2900, inside the partition's west face.
        const settled = slideAlongWalls(barriers, { x: 2900, y: 1000 });

        expect(settled.x).toBeCloseTo(3000 - 50 - SHOULDER);
        expect(settled.y).toBeCloseTo(1000);
    });

    it('lets a walker through a doorway', () => {
        const settled = slideAlongWalls(barriers, { x: 3000, y: 2000 });

        expect(settled).toEqual({ x: 3000, y: 2000 });
    });

    it('pushes a walker standing in a wall out to its nearest face', () => {
        // Just inside the south wall's body, nearer the outside than the in.
        const settled = slideAlongWalls(barriers, { x: 1000, y: -100 });

        expect(settled.y).toBeCloseTo(-(150 + SHOULDER));
    });

    it('leaves open floor alone', () => {
        const open = { x: 1500, y: 2000 };

        expect(slideAlongWalls(barriers, open)).toEqual(open);
    });

    it('clears both walls of an inside corner, not just the last one', () => {
        const settled = slideAlongWalls(barriers, { x: 200, y: 200 });

        expect(settled.x).toBeGreaterThanOrEqual(150 + SHOULDER - 1);
        expect(settled.y).toBeGreaterThanOrEqual(150 + SHOULDER - 1);
    });
});

describe('stepWalker', () => {
    const standing = {
        eye: { x: 1500, y: 2000, z: EYE_HEIGHT },
        yaw: 0,
        pitch: 0,
    };

    it('walks in the direction it faces', () => {
        const moved = stepWalker(standing, barriers, 500, 0);

        expect(moved.eye.x).toBeCloseTo(2000);
        expect(moved.eye.y).toBeCloseTo(2000);
    });

    it('is stopped by a wall rather than passing through it', () => {
        // Due east from here is the partition, and 5 m would clear it.
        const moved = stepWalker(
            { ...standing, eye: { ...standing.eye, y: 500 } },
            barriers,
            5000,
            0,
        );

        expect(moved.eye.x).toBeCloseTo(3000 - 50 - SHOULDER);
    });

    it('does not tunnel through a wall on a slow frame', () => {
        // A dropped frame asks for a step far longer than any wall is thick.
        // Taken in one jump it would land the client in their garden.
        const moved = stepWalker(
            { ...standing, eye: { ...standing.eye, y: 500 } },
            barriers,
            50_000,
            0,
        );

        expect(moved.eye.x).toBeCloseTo(3000 - 50 - SHOULDER);
    });

    it('walks through a doorway when it is lined up with one', () => {
        const moved = stepWalker(
            { ...standing, eye: { x: 1500, y: 2000, z: EYE_HEIGHT } },
            barriers,
            3000,
            0,
        );

        expect(moved.eye.x).toBeGreaterThan(3000);
    });

    it('keeps the eye at its height', () => {
        const moved = stepWalker(standing, barriers, 500, 300);

        expect(moved.eye.z).toBe(EYE_HEIGHT);
    });

    it('stands still when nothing is pressed', () => {
        expect(stepWalker(standing, barriers, 0, 0)).toBe(standing);
    });
});

describe('startingPose', () => {
    it('puts the eye at head height on its level', () => {
        const pose = startingPose(
            document,
            { id: 'level-2', name: 'Level 2', elevation: 3000 },
            [],
        );

        expect(pose.eye.z).toBe(3000 + EYE_HEIGHT);
    });

    it('does not start the walker inside a wall', () => {
        // The centre of this plan is the partition itself, so an unchecked
        // start would put the client standing in it.
        const pose = startingPose(
            document,
            { id: 'level-1', name: 'Level 1', elevation: 0 },
            barriers,
        );

        const settled = slideAlongWalls(barriers, {
            x: pose.eye.x,
            y: pose.eye.y,
        });

        expect(settled.x).toBeCloseTo(pose.eye.x);
        expect(settled.y).toBeCloseTo(pose.eye.y);
    });
});
