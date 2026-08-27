import { describe, expect, it } from 'vitest';
import {
    compileParts,
    compileScene,
    DEFAULT_PART_COLOUR,
    ITEM_PRESETS,
    itemSnapshot,
    readHex,
    MAX_TRIANGLES,
    meshFromPayload,
    newPart,
    newSketchPart,
    payloadFromMesh,
    resizePart,
    simplifyStroke,
    triangulateOutline,
} from '@/lib/cad/library';
import type { ItemPart } from '@/lib/cad/library';

function box(overrides: Partial<ItemPart> = {}): ItemPart {
    return { ...newPart('box'), ...overrides };
}

describe('compileParts', () => {
    it('compiles a box into twelve outward triangles', () => {
        const mesh = compileParts('Crate', [
            box({ width: 600, depth: 400, height: 300 }),
        ]);

        expect(mesh.triangleCount).toBe(12);
        expect(mesh.vertices.length).toBe(12 * 9);
        expect(mesh.size).toEqual({ x: 600, y: 400, z: 300 });
    });

    it('normalises so the base sits at zero and the plan is centred', () => {
        const mesh = compileParts('Floating', [
            box({ x: 5000, y: -2000, z: 700 }),
        ]);

        const zs = mesh.vertices.filter((_, index) => index % 3 === 2);
        const xs = mesh.vertices.filter((_, index) => index % 3 === 0);

        expect(Math.min(...zs)).toBe(0);
        expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(0);
        expect(mesh.footprint.length).toBeGreaterThanOrEqual(4);
    });

    it('a cylinder rounds out with caps and sides', () => {
        const mesh = compileParts('Drum', [
            { ...newPart('cylinder'), width: 400, depth: 400, height: 500 },
        ]);

        // 12 segments × (2 caps + 2 side triangles).
        expect(mesh.triangleCount).toBe(48);
        expect(mesh.size.z).toBe(500);
        // An ellipse footprint, not a bounding square.
        expect(mesh.size.x).toBeCloseTo(400, 0);
    });

    it('rotation carries a part around the vertical axis', () => {
        const straight = compileParts('A', [
            box({ width: 1000, depth: 200, height: 100 }),
        ]);
        const turned = compileParts('B', [
            box({ width: 1000, depth: 200, height: 100, rotation: 90 }),
        ]);

        expect(straight.size.x).toBeCloseTo(1000);
        expect(turned.size.x).toBeCloseTo(200);
        expect(turned.size.y).toBeCloseTo(1000);
    });

    it('an empty part list compiles to an empty mesh, not a crash', () => {
        const mesh = compileParts('Nothing', []);

        expect(mesh.triangleCount).toBe(0);
        expect(mesh.footprint).toEqual([]);
    });

    it('every preset compiles inside the import cap', () => {
        for (const preset of ITEM_PRESETS) {
            const mesh = compileParts(
                preset.name,
                preset.parts.map((part, index) => ({
                    ...part,
                    id: `part-${index}`,
                })),
            );

            expect(mesh.triangleCount).toBeGreaterThan(0);
            expect(mesh.triangleCount).toBeLessThan(MAX_TRIANGLES);
            expect(mesh.size.z).toBeGreaterThan(0);
        }
    });
});

describe('itemSnapshot', () => {
    it('draws a shaded SVG data URL', () => {
        const mesh = compileParts('Crate', [box()]);
        const snapshot = itemSnapshot(mesh.vertices);

        expect(snapshot.startsWith('data:image/svg+xml')).toBe(true);

        const svg = decodeURIComponent(snapshot.split(',')[1]);

        expect(svg).toContain('<polygon');
        expect(svg).toContain('viewBox=');
        // Culling: a box shows at most three faces, six triangles.
        expect(svg.match(/<polygon/g)?.length).toBeLessThanOrEqual(6);
    });

    it('is deterministic for the same mesh', () => {
        const mesh = compileParts('Crate', [box()]);

        expect(itemSnapshot(mesh.vertices)).toBe(itemSnapshot(mesh.vertices));
    });

    it('survives an empty mesh', () => {
        expect(itemSnapshot([]).startsWith('data:image/svg+xml')).toBe(true);
    });
});

describe('the payload round trip', () => {
    it('keeps everything insertMesh needs, and the parts when designed', () => {
        const parts = [box({ name: 'Seat' })];
        const mesh = compileParts('Couch', parts);
        const payload = payloadFromMesh(mesh, parts);
        const back = meshFromPayload('Couch', payload);

        expect(back.vertices).toEqual(mesh.vertices);
        expect(back.footprint).toEqual(mesh.footprint);
        expect(back.size).toEqual(mesh.size);
        expect(back.triangleCount).toBe(mesh.triangleCount);
        expect(payload.parts?.[0].name).toBe('Seat');
    });

    it('an imported file carries no parts', () => {
        const mesh = compileParts('Scan', [box()]);

        expect(payloadFromMesh(mesh).parts).toBeUndefined();
    });
});

describe('sketch parts', () => {
    it('triangulates a square into two counter-clockwise ears', () => {
        const ears = triangulateOutline([
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 0, y: 100 },
        ]);

        expect(ears).toHaveLength(2);
    });

    it('triangulates a concave L-shape completely', () => {
        const outline = [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
            { x: 200, y: 100 },
            { x: 100, y: 100 },
            { x: 100, y: 200 },
            { x: 0, y: 200 },
        ];

        const ears = triangulateOutline(outline);

        // n − 2 triangles for a simple polygon of n corners.
        expect(ears).toHaveLength(4);

        const area = ears.reduce((total, [a, b, c]) => {
            const p = outline[a];
            const q = outline[b];
            const r = outline[c];

            return (
                total +
                Math.abs(
                    (q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y),
                ) /
                    2
            );
        }, 0);

        // The L covers 3 of the 4 quadrants of a 200×200 square.
        expect(area).toBeCloseTo(30000);
    });

    it('accepts an outline drawn in either direction', () => {
        const clockwise = [
            { x: 0, y: 0 },
            { x: 0, y: 100 },
            { x: 100, y: 100 },
            { x: 100, y: 0 },
        ];

        expect(triangulateOutline(clockwise)).toHaveLength(2);
    });

    it('extrudes a drawn outline into a solid part', () => {
        const part = newSketchPart([
            { x: 0, y: 0 },
            { x: 400, y: 0 },
            { x: 400, y: 300 },
            { x: 0, y: 300 },
        ]);
        const mesh = compileParts('Slab', [{ ...part, height: 50 }]);

        // 2 ears top + 2 bottom + 4 sides × 2.
        expect(mesh.triangleCount).toBe(12);
        expect(mesh.size).toEqual({ x: 400, y: 300, z: 50 });
    });

    it('centres a drawn outline and reads its extents as width and depth', () => {
        const part = newSketchPart([
            { x: 1000, y: 2000 },
            { x: 1600, y: 2000 },
            { x: 1600, y: 2400 },
            { x: 1000, y: 2400 },
        ]);

        expect(part.width).toBe(600);
        expect(part.depth).toBe(400);
        expect(Math.min(...part.points!.map((p) => p.x))).toBe(-300);
    });

    it('resizing a sketch rescales its outline with it', () => {
        const part = newSketchPart([
            { x: 0, y: 0 },
            { x: 600, y: 0 },
            { x: 600, y: 400 },
            { x: 0, y: 400 },
        ]);

        const wider = resizePart(part, { width: 1200 });

        expect(wider.width).toBe(1200);
        expect(Math.max(...wider.points!.map((p) => p.x))).toBe(600);
        // Depth untouched.
        expect(Math.max(...wider.points!.map((p) => p.y))).toBe(200);
    });

    it('thins a noisy stroke down to its corners', () => {
        const noisy: { x: number; y: number }[] = [];

        // A wobbly straight line of 50 points…
        for (let step = 0; step <= 50; step++) {
            noisy.push({ x: step * 10, y: (step % 2) * 1.5 });
        }

        const simplified = simplifyStroke(noisy, 3);

        expect(simplified).toHaveLength(2);
        expect(simplified[0]).toEqual(noisy[0]);
        expect(simplified[simplified.length - 1]).toEqual(
            noisy[noisy.length - 1],
        );
    });

    it('keeps a genuine corner while thinning', () => {
        const corner = [
            { x: 0, y: 0 },
            { x: 100, y: 1 },
            { x: 200, y: 0 },
            { x: 200, y: 200 },
        ];

        const simplified = simplifyStroke(corner, 3);

        expect(simplified).toContainEqual({ x: 200, y: 0 });
    });
});

describe('materials and the scene', () => {
    it('keeps each part separate, shifted to match the whole item', () => {
        const parts = [
            box({ name: 'Seat', colour: '#6b4a33' }),
            box({ name: 'Leg', z: 400, colour: '#3a3a3c' }),
        ];
        const scene = compileScene('Stool', parts);

        expect(scene.pieces).toHaveLength(2);
        expect(scene.pieces[0]).toMatchObject({
            name: 'Seat',
            colour: '#6b4a33',
        });

        // Every piece triangle appears in the mesh at the same coordinates.
        const soup = scene.pieces.flatMap((piece) => piece.vertices);

        expect(soup).toHaveLength(scene.mesh.vertices.length);
        soup.forEach((value, index) => {
            expect(value).toBeCloseTo(scene.mesh.vertices[index], 6);
        });
    });

    it('a part with no material falls back rather than vanishing', () => {
        const scene = compileScene('Plain', [box()]);

        expect(scene.pieces[0].colour).toBe(DEFAULT_PART_COLOUR);
    });

    it('compileParts still returns exactly the scene mesh', () => {
        const parts = [box(), box({ z: 500 })];

        expect(compileParts('Same', parts)).toEqual(
            compileScene('Same', parts).mesh,
        );
    });

    it('an empty item has no pieces and no mesh', () => {
        const scene = compileScene('Nothing', []);

        expect(scene.pieces).toEqual([]);
        expect(scene.mesh.triangleCount).toBe(0);
    });

    it('reads hex colours, and refuses nonsense without throwing', () => {
        expect(readHex('#6b4a33')).toEqual([107, 74, 51]);
        expect(readHex('6b4a33')).toEqual([107, 74, 51]);
        expect(readHex('rebeccapurple')).toEqual(readHex(DEFAULT_PART_COLOUR));
        expect(readHex('')).toEqual(readHex(DEFAULT_PART_COLOUR));
    });

    it('the snapshot paints each part in its own material', () => {
        const scene = compileScene('Two-tone', [
            box({ colour: '#c8a578' }),
            box({ z: 500, colour: '#3a3a3c' }),
        ]);

        const svg = decodeURIComponent(
            itemSnapshot(scene.mesh.vertices, scene.pieces).split(',')[1],
        );

        // Two materials, lit and shaded, give more than one fill.
        const fills = new Set(svg.match(/fill="rgb\([^)]+\)"/g) ?? []);

        expect(fills.size).toBeGreaterThan(1);
    });

    it('the snapshot still works with no pieces given', () => {
        const scene = compileScene('Plain', [box()]);
        const svg = decodeURIComponent(
            itemSnapshot(scene.mesh.vertices).split(',')[1],
        );

        expect(svg).toContain('<polygon');
    });

    it('every preset gives its parts a material', () => {
        for (const preset of ITEM_PRESETS) {
            for (const part of preset.parts) {
                expect(part.colour).toMatch(/^#[0-9a-f]{6}$/);
            }
        }
    });
});
