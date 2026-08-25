import { describe, expect, it } from 'vitest';
import { testDocument } from '@/lib/cad/__fixtures__/document';
import { signedArea } from '@/lib/cad/geometry';
import {
    boundsOfSolids,
    buildSolids,
    ensureCounterClockwise,
    faceNormal,
    prism,
    solidTriangles,
    triangulateFace,
} from '@/lib/cad/solids';
import type { Solid, Vec3 } from '@/lib/cad/solids';

/**
 * A closed manifold uses every edge exactly twice, once in each direction.
 * Anything else means a hole, a duplicate face or an inconsistent winding.
 */
function edgeBalance(solid: Solid): { unmatched: string[]; total: number } {
    const counts = new Map<string, number>();
    const key = (v: Vec3) =>
        `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;

    solid.faces.forEach((face) => {
        for (let index = 0; index < face.length; index++) {
            const from = key(face[index]);
            const to = key(face[(index + 1) % face.length]);
            const directed = `${from}|${to}`;
            const opposite = `${to}|${from}`;

            counts.set(directed, (counts.get(directed) ?? 0) + 1);
            counts.set(opposite, counts.get(opposite) ?? 0);
        }
    });

    const unmatched: string[] = [];

    counts.forEach((count, directed) => {
        const [from, to] = directed.split('|');
        const opposite = counts.get(`${to}|${from}`) ?? 0;

        if (count !== opposite) {
            unmatched.push(directed);
        }
    });

    return { unmatched, total: counts.size };
}

/** Positive when every face normal points away from the interior. */
function signedVolume(solid: Solid): number {
    return solidTriangles(solid).reduce(
        (total, [a, b, c]) =>
            total +
            (a.x * (b.y * c.z - b.z * c.y) +
                a.y * (b.z * c.x - b.x * c.z) +
                a.z * (b.x * c.y - b.y * c.x)) /
                6,
        0,
    );
}

describe('prism', () => {
    it('closes a box and points every normal outward', () => {
        const box = prism(
            [
                { x: 0, y: 0 },
                { x: 1000, y: 0 },
                { x: 1000, y: 500 },
                { x: 0, y: 500 },
            ],
            0,
            2000,
        );
        const solid: Solid = {
            id: 'box',
            name: 'box',
            category: 'wall',
            elementId: 'box',
            level: 'level-1',
            faces: box,
            base: 0,
        };

        expect(box).toHaveLength(6);
        expect(edgeBalance(solid).unmatched).toEqual([]);
        expect(signedVolume(solid)).toBeCloseTo(1000 * 500 * 2000, 0);
    });

    it('accepts a clockwise footprint and still points outward', () => {
        const clockwise = [
            { x: 0, y: 0 },
            { x: 0, y: 500 },
            { x: 1000, y: 500 },
            { x: 1000, y: 0 },
        ];

        const solid: Solid = {
            id: 'box',
            name: 'box',
            category: 'wall',
            elementId: 'box',
            level: 'level-1',
            faces: prism(clockwise, 0, 1000),
            base: 0,
        };

        expect(signedVolume(solid)).toBeGreaterThan(0);
        expect(edgeBalance(solid).unmatched).toEqual([]);
    });

    it('handles a concave footprint', () => {
        // An L shape: concave at the inner corner.
        const shape = [
            { x: 0, y: 0 },
            { x: 2000, y: 0 },
            { x: 2000, y: 1000 },
            { x: 1000, y: 1000 },
            { x: 1000, y: 2000 },
            { x: 0, y: 2000 },
        ];
        const solid: Solid = {
            id: 'l',
            name: 'l',
            category: 'floor',
            elementId: 'l',
            level: 'level-1',
            faces: prism(shape, 0, 100),
            base: 0,
        };

        expect(solid.faces).toHaveLength(8);
        expect(edgeBalance(solid).unmatched).toEqual([]);
        // 2000x1000 plus 1000x1000, one hundred deep.
        expect(signedVolume(solid)).toBeCloseTo(3_000_000 * 100, 0);
    });

    it('returns nothing for a zero height extrusion', () => {
        expect(
            prism(
                [
                    { x: 0, y: 0 },
                    { x: 1, y: 0 },
                    { x: 1, y: 1 },
                ],
                500,
                500,
            ),
        ).toEqual([]);
    });
});

describe('ensureCounterClockwise', () => {
    it('leaves a counter-clockwise ring alone', () => {
        const ring = [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
        ];

        expect(ensureCounterClockwise(ring)).toBe(ring);
    });

    it('reverses a clockwise ring', () => {
        const ring = [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
            { x: 1, y: 0 },
        ];
        const fixed = ensureCounterClockwise(ring);

        expect(fixed).toEqual([...ring].reverse());
        expect(signedArea(fixed)).toBeGreaterThan(0);
    });
});

describe('triangulateFace', () => {
    it('keeps the winding of a downward facing polygon', () => {
        const face: Vec3[] = [
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 1000, z: 0 },
            { x: 1000, y: 1000, z: 0 },
            { x: 1000, y: 0, z: 0 },
        ];
        const before = faceNormal(face);

        triangulateFace(face).forEach((triangle) => {
            const after = faceNormal(triangle);

            expect(after.z).toBeCloseTo(before.z, 6);
        });
    });

    it('keeps the winding of a vertical polygon', () => {
        const face: Vec3[] = [
            { x: 0, y: 0, z: 0 },
            { x: 1000, y: 0, z: 0 },
            { x: 1000, y: 0, z: 1000 },
            { x: 0, y: 0, z: 1000 },
        ];
        const before = faceNormal(face);

        triangulateFace(face).forEach((triangle) => {
            expect(faceNormal(triangle).y).toBeCloseTo(before.y, 6);
        });
    });
});

describe('buildSolids', () => {
    const document = testDocument();

    it('gives every solid a closed shell', () => {
        buildSolids(document).forEach((solid) => {
            if (solid.category === 'mesh') {
                return;
            }

            expect(
                edgeBalance(solid),
                `${solid.id} is not closed`,
            ).toMatchObject({
                unmatched: [],
            });
            expect(
                signedVolume(solid),
                `${solid.id} is inside out`,
            ).toBeGreaterThan(0);
        });
    });

    it('splits a wall around its opening and adds the lintel', () => {
        const partition = buildSolids(document).filter(
            (solid) =>
                solid.elementId === 'part-1' && solid.category === 'wall',
        );

        // Two runs either side of the door plus the lintel above it.
        expect(partition.map((solid) => solid.id).sort()).toEqual([
            'part-1-lintel-1',
            'part-1-run-1',
            'part-1-run-2',
        ]);
    });

    it('adds a sill below a window as well as a lintel', () => {
        const wall = buildSolids(document).filter(
            (solid) =>
                solid.elementId === 'shell-1' && solid.category === 'wall',
        );

        expect(wall.map((solid) => solid.id)).toContain('shell-1-sill-1');
        expect(wall.map((solid) => solid.id)).toContain('shell-1-lintel-1');
    });

    it('scopes to a single level', () => {
        const onLevelTwo = buildSolids(document, { levels: ['level-2'] });

        expect(onLevelTwo).toEqual([]);
    });

    it('scopes to a selection, keeping every solid of the chosen element', () => {
        const solids = buildSolids(document, {
            elementIds: ['column-1', 'slab-1'],
        });

        expect(solids.map((solid) => solid.elementId).sort()).toEqual([
            'column-1',
            'slab-1',
        ]);
    });

    it('places the slab below the level and the walls above it', () => {
        const solids = buildSolids(document);
        const slab = solids.find((solid) => solid.category === 'floor');
        const wall = solids.find((solid) => solid.category === 'wall');

        expect(slab?.base).toBe(-200);
        expect(wall?.base).toBe(0);
    });

    it('measures the model extents', () => {
        const bounds = boundsOfSolids(buildSolids(document));

        expect(bounds?.min.x).toBeCloseTo(-150, 0);
        expect(bounds?.max.x).toBeCloseTo(6150, 0);
        expect(bounds?.max.z).toBeCloseTo(3000, 0);
    });
});
