import { describe, expect, it } from 'vitest';
import {
    alignWallTo,
    linearArray,
    offsetWall,
    splitWall,
    trimExtendToCorner,
} from '@/lib/cad/modify';
import { buildSolids, roofRidge, stairSteps } from '@/lib/cad/solids';
import type {
    CadDocument,
    DoorElement,
    RoofElement,
    StairElement,
    WallElement,
} from '@/lib/cad/types';

function wall(
    id: string,
    a: [number, number],
    b: [number, number],
): WallElement {
    return {
        id,
        kind: 'wall',
        level: 'level-1',
        typeId: 'generic-200',
        a: { x: a[0], y: a[1] },
        b: { x: b[0], y: b[1] },
        height: 3000,
        baseOffset: 0,
        locationLine: 'center',
    };
}

function documentWith(elements: CadDocument['elements']): CadDocument {
    return {
        version: 1,
        units: 'metric',
        levels: [{ id: 'level-1', name: 'Level 1', elevation: 0 }],
        wallTypes: [
            {
                id: 'generic-200',
                name: 'Generic - 200mm',
                thickness: 200,
                function: 'exterior',
            },
        ],
        doorTypes: [
            {
                id: 'door-915',
                name: 'Single-Flush',
                width: 915,
                height: 2134,
                leaves: 1,
            },
        ],
        windowTypes: [],
        elements,
        viewSettings: {},
    };
}

const wallsOf = (document: CadDocument): WallElement[] =>
    document.elements.filter(
        (element): element is WallElement => element.kind === 'wall',
    );

describe('trimExtendToCorner', () => {
    it('extends two walls to meet at their intersection', () => {
        const document = documentWith([
            wall('w1', [0, 0], [4000, 0]),
            wall('w2', [6000, 2000], [6000, 5000]),
        ]);

        const result = trimExtendToCorner(document, 'w1', 'w2');
        const walls = wallsOf(result!);

        // w1's b end reaches the corner, w2's a end drops to it.
        expect(walls[0].b).toMatchObject({ x: 6000, y: 0 });
        expect(walls[1].a).toMatchObject({ x: 6000, y: 0 });
    });

    it('refuses parallel walls', () => {
        const document = documentWith([
            wall('w1', [0, 0], [4000, 0]),
            wall('w2', [0, 2000], [4000, 2000]),
        ]);

        expect(trimExtendToCorner(document, 'w1', 'w2')).toBeNull();
    });
});

describe('splitWall', () => {
    it('splits a wall into two halves at the point', () => {
        const document = documentWith([wall('w1', [0, 0], [6000, 0])]);

        const result = splitWall(document, 'w1', { x: 2000, y: 50 });
        const walls = wallsOf(result!.document);

        expect(walls).toHaveLength(2);
        expect(walls[0].b.x).toBeCloseTo(2000);
        expect(walls[1].a.x).toBeCloseTo(2000);
        expect(walls[1].b.x).toBeCloseTo(6000);
    });

    it('rehosts an opening onto the half that contains it', () => {
        const door: DoorElement = {
            id: 'd1',
            kind: 'door',
            level: 'level-1',
            typeId: 'door-915',
            host: 'w1',
            t: 0.75,
            flipFace: false,
            flipHand: false,
        };
        const document = documentWith([wall('w1', [0, 0], [6000, 0]), door]);

        const result = splitWall(document, 'w1', { x: 3000, y: 0 })!;
        const moved = result.document.elements.find(
            (element): element is DoorElement => element.kind === 'door',
        )!;

        // The door sat at 4500mm, which is 1500mm into the 3000mm second half.
        expect(moved.host).toBe(result.createdId);
        expect(moved.t).toBeCloseTo(0.5);
    });

    it('refuses to split too near an end', () => {
        const document = documentWith([wall('w1', [0, 0], [6000, 0])]);

        expect(splitWall(document, 'w1', { x: 40, y: 0 })).toBeNull();
    });
});

describe('alignWallTo', () => {
    it('makes the target collinear with the reference', () => {
        const document = documentWith([
            wall('ref', [0, 0], [6000, 0]),
            wall('target', [1000, 800], [4000, 900]),
        ]);

        const result = alignWallTo(document, 'ref', 'target')!;
        const target = wallsOf(result)[1];

        expect(target.a.y).toBeCloseTo(0);
        expect(target.b.y).toBeCloseTo(0);
        expect(target.a.x).toBeCloseTo(1000);
    });
});

describe('offsetWall', () => {
    it('copies the wall parallel on the side of the pick', () => {
        const document = documentWith([wall('w1', [0, 0], [6000, 0])]);

        const result = offsetWall(document, 'w1', 600, { x: 3000, y: 500 })!;
        const walls = wallsOf(result.document);

        expect(walls).toHaveLength(2);
        // The pick point sat at +y, so the copy lands on that side.
        expect(walls[1].a.y).toBeCloseTo(600);
        expect(walls[1].b.x).toBeCloseTo(6000);
    });
});

describe('linearArray', () => {
    it('creates count minus one copies at even spacing', () => {
        const document = documentWith([wall('w1', [0, 0], [2000, 0])]);

        const result = linearArray(document, ['w1'], { x: 0, y: 3000 }, 4);
        const walls = wallsOf(result);

        expect(walls).toHaveLength(4);
        expect(walls.map((item) => item.a.y).sort((a, b) => a - b)).toEqual([
            0, 3000, 6000, 9000,
        ]);
    });
});

describe('roof and stair solids', () => {
    const roof: RoofElement = {
        id: 'r1',
        kind: 'roof',
        level: 'level-1',
        points: [
            { x: 0, y: 0 },
            { x: 8000, y: 0 },
            { x: 8000, y: 5000 },
            { x: 0, y: 5000 },
        ],
        slope: 30,
        overhang: 500,
        baseOffset: 3000,
    };

    it('gives a rectangular roof a hip ridge along the long axis', () => {
        const ridge = roofRidge(roof.points, roof.slope);

        expect(ridge.points).toHaveLength(2);
        // Ridge inset by half the short span from each short edge.
        expect(ridge.points[0].y).toBeCloseTo(2500);
        expect(ridge.height).toBeCloseTo(2500 * Math.tan(Math.PI / 6));
    });

    it('builds a closed roof solid above the plate', () => {
        const document = documentWith([roof]);
        const solids = buildSolids(document);

        expect(solids).toHaveLength(1);
        expect(solids[0].category).toBe('roof');

        const zs = solids[0].faces.flat().map((v) => v.z);
        expect(Math.min(...zs)).toBeCloseTo(3000);
        expect(Math.max(...zs)).toBeGreaterThan(3000);
    });

    it('derives stair steps from the rise and max riser', () => {
        const stair: StairElement = {
            id: 's1',
            kind: 'stair',
            level: 'level-1',
            a: { x: 0, y: 0 },
            b: { x: 4200, y: 0 },
            width: 1000,
            rise: 3000,
        };

        const { count, riser } = stairSteps(stair);

        expect(count).toBe(16);
        expect(riser).toBeCloseTo(187.5);

        const solids = buildSolids(documentWith([stair]));
        expect(solids).toHaveLength(16);
        expect(solids.every((solid) => solid.category === 'stair')).toBe(true);
    });
});
