import { describe, expect, it } from 'vitest';
import { assemblyOf, assemblySolids } from '@/lib/cad/assembly';
import { explodedSolids, focusedAssembly } from '@/lib/cad/explode';
import { boundsOfSolids, buildSolids } from '@/lib/cad/solids';
import type { Solid } from '@/lib/cad/solids';
import type { CadDocument, WallElement } from '@/lib/cad/types';

function baseDocument(overrides: Partial<CadDocument> = {}): CadDocument {
    return {
        version: 1,
        units: 'metric',
        levels: [
            { id: 'l1', name: 'Level 1', elevation: 0 },
            { id: 'l2', name: 'Level 2', elevation: 3000 },
        ],
        wallTypes: [
            {
                id: 'ext',
                name: 'Exterior - Stud and Sheathing',
                thickness: 200,
                function: 'exterior',
                construction: 'wood',
            },
            {
                id: 'int',
                name: 'Interior - 92mm Partition',
                thickness: 92,
                function: 'interior',
                construction: 'wood',
            },
            {
                id: 'conc',
                name: 'Exterior - 300 Concrete',
                thickness: 300,
                function: 'exterior',
                construction: 'concrete',
            },
        ],
        doorTypes: [
            { id: 'd', name: 'D', width: 900, height: 2100, leaves: 1 },
        ],
        windowTypes: [
            {
                id: 'w',
                name: 'W',
                width: 1200,
                height: 1200,
                sillHeight: 900,
            },
        ],
        elements: [],
        viewSettings: {},
        ...overrides,
    };
}

function wall(
    id: string,
    typeId: string,
    level = 'l1',
    overrides: Partial<WallElement> = {},
): WallElement {
    return {
        id,
        kind: 'wall',
        level,
        typeId,
        a: { x: 0, y: 0 },
        b: { x: 4000, y: 0 },
        height: 2400,
        baseOffset: 0,
        locationLine: 'center',
        ...overrides,
    };
}

/** Every vertex of a set of solids, for measuring how far things moved. */
function span(solids: Solid[]) {
    const bounds = boundsOfSolids(solids);

    if (!bounds) {
        throw new Error('no solids');
    }

    return {
        x: bounds.max.x - bounds.min.x,
        y: bounds.max.y - bounds.min.y,
        z: bounds.max.z - bounds.min.z,
    };
}

describe('what a thing is made of', () => {
    it('lists an exterior wall outside face first', () => {
        const document = baseDocument();
        const assembly = assemblyOf(document, wall('w1', 'ext'))!;

        expect(assembly.layers.map((layer) => layer.name)).toEqual([
            'Cladding',
            'Sheathing 11mm OSB',
            'Studs and insulation 152mm',
            'Gypsum board 12.7mm',
        ]);

        // The layers add up to the wall it came from.
        expect(assembly.thickness).toBeCloseTo(200, 5);
    });

    it('boards an interior wall on both faces', () => {
        const document = baseDocument();
        const assembly = assemblyOf(document, wall('w1', 'int'))!;

        expect(assembly.layers.map((layer) => layer.name)).toEqual([
            'Gypsum board 12.7mm',
            'Studs 67mm',
            'Gypsum board 12.7mm',
        ]);
    });

    it('leaves a poured wall as one thing, because it is one thing', () => {
        const document = baseDocument();
        const assembly = assemblyOf(document, wall('w1', 'conc'))!;

        expect(assembly.layers).toHaveLength(1);
        expect(assembly.layers[0].name).toBe('Cast-in-place concrete');
    });

    it('has nothing to say about a beam', () => {
        const document = baseDocument();

        expect(
            assemblyOf(document, {
                id: 'b1',
                kind: 'beam',
                level: 'l1',
                a: { x: 0, y: 0 },
                b: { x: 3000, y: 0 },
                width: 200,
                depth: 400,
                elevation: 2400,
            }),
        ).toBeNull();
    });

    it('builds each layer as its own solid, spanning the whole wall', () => {
        const document = baseDocument({ elements: [wall('w1', 'ext')] });
        const layers = assemblySolids(document, document.elements[0]);

        // Four layers, but more solids than that: the cavity is built as the
        // framing it really is rather than as a slab.
        expect(new Set(layers.map((layer) => layer.assemblyLayer)).size).toBe(
            4,
        );
        expect(layers.map((layer) => layer.name)).toContain('Cladding');

        // Together the layers occupy exactly the wall's own volume.
        const whole = span(buildSolids(document));
        const apart = span(layers);

        expect(apart.x).toBeCloseTo(whole.x, 3);
        expect(apart.y).toBeCloseTo(whole.y, 3);
        expect(apart.z).toBeCloseTo(whole.z, 3);
    });
});

describe('framing inside a wall', () => {
    it('builds studs, plates and batt rather than a slab', () => {
        const document = baseDocument({ elements: [wall('w1', 'ext')] });
        const parts = assemblySolids(document, document.elements[0]);
        const named = (name: string) =>
            parts.filter((part) => part.name === name);

        // A 4m wall at 400 centres: a stud every bay plus one at each end.
        expect(named('Stud')).toHaveLength(11);
        expect(named('Batt insulation')).toHaveLength(10);
        expect(named('Sole plate')).toHaveLength(1);
        expect(named('Double top plate')).toHaveLength(1);

        // All of it is one layer of the sandwich, so it travels together.
        const framing = new Set(
            [...named('Stud'), ...named('Sole plate')].map(
                (part) => part.assemblyLayer,
            ),
        );

        expect(framing.size).toBe(1);
    });

    it('stands the studs inside the wall, between the plates', () => {
        const document = baseDocument({ elements: [wall('w1', 'ext')] });
        const parts = assemblySolids(document, document.elements[0]);
        const studs = parts.filter((part) => part.name === 'Stud');
        const zs = studs.flatMap((stud) => stud.faces.flat()).map((v) => v.z);

        // Off the sole plate at the bottom, under the doubled top plate.
        expect(Math.min(...zs)).toBeCloseTo(38);
        expect(Math.max(...zs)).toBeCloseTo(2400 - 76);
    });

    it('names what each part is made of', () => {
        const document = baseDocument({ elements: [wall('w1', 'ext')] });
        const parts = assemblySolids(document, document.elements[0]);
        const materialOf = (name: string) =>
            parts.find((part) => part.name === name)?.material;

        expect(materialOf('Stud')).toBe('wood');
        expect(materialOf('Batt insulation')).toBe('insulation');
        expect(materialOf('Sheathing 11mm OSB')).toBe('sheathing');
        expect(materialOf('Gypsum board 12.7mm')).toBe('gypsum');
    });

    it('leaves a poured wall as the one body it is', () => {
        const document = baseDocument({ elements: [wall('w1', 'conc')] });
        const parts = assemblySolids(document, document.elements[0]);

        expect(parts).toHaveLength(1);
        expect(parts[0].material).toBe('concrete');
    });

    it('does not try to frame a wall too short to hold a stud', () => {
        const document = baseDocument({
            elements: [
                wall('w1', 'ext', 'l1', {
                    a: { x: 0, y: 0 },
                    b: { x: 50, y: 0 },
                }),
            ],
        });

        // A 50mm offcut has no room for framing; it must not throw or
        // produce studs wider than the wall.
        expect(() =>
            assemblySolids(document, document.elements[0]),
        ).not.toThrow();
    });
});

describe('exploding', () => {
    it('leaves the model alone at rest', () => {
        const document = baseDocument({
            elements: [wall('w1', 'ext'), wall('w2', 'ext', 'l2')],
        });

        const still = explodedSolids(document, { factor: 0 });

        expect(span(still)).toEqual(span(buildSolids(document)));
    });

    it('opens the whole building out, and lifts the storeys apart', () => {
        const document = baseDocument({
            elements: [
                wall('w1', 'ext'),
                wall('w2', 'ext', 'l1', {
                    a: { x: 0, y: 6000 },
                    b: { x: 4000, y: 6000 },
                }),
                wall('w3', 'ext', 'l2'),
            ],
        });

        const assembled = span(buildSolids(document));
        const apart = span(explodedSolids(document, { factor: 1 }));

        // Walls drift away from the centre, and Level 2 climbs off Level 1.
        expect(apart.y).toBeGreaterThan(assembled.y);
        expect(apart.z).toBeGreaterThan(assembled.z);
    });

    it('takes one selected wall apart and leaves the rest standing', () => {
        const document = baseDocument({
            elements: [
                wall('w1', 'ext'),
                wall('w2', 'ext', 'l1', {
                    a: { x: 0, y: 6000 },
                    b: { x: 4000, y: 6000 },
                }),
            ],
        });

        const apart = explodedSolids(document, { factor: 1, focus: 'w1' });

        // The focused wall is now its four layers; the other is untouched.
        const fromFocus = apart.filter((solid) => solid.elementId === 'w1');
        const other = apart.filter((solid) => solid.elementId === 'w2');

        expect(
            new Set(fromFocus.map((solid) => solid.assemblyLayer)).size,
        ).toBe(4);
        expect(other).toHaveLength(1);
        expect(span(other)).toEqual(
            span(buildSolids(document).filter((s) => s.elementId === 'w2')),
        );
    });

    it('peels a wall apart across its face, not along its length', () => {
        const document = baseDocument({ elements: [wall('w1', 'ext')] });

        const assembled = span(buildSolids(document));
        const apart = span(
            explodedSolids(document, { factor: 1, focus: 'w1' }),
        );

        // The wall runs east-west, so its layers separate north-south.
        expect(apart.y).toBeGreaterThan(assembled.y * 4);
        expect(apart.x).toBeCloseTo(assembled.x, 3);
    });

    it('moves a door out of the way of the wall it is cut into', () => {
        const document = baseDocument({
            elements: [
                wall('w1', 'ext'),
                {
                    id: 'dr',
                    kind: 'door',
                    level: 'l1',
                    typeId: 'd',
                    host: 'w1',
                    t: 0.5,
                    flipFace: false,
                    flipHand: false,
                },
            ],
        });

        const apart = explodedSolids(document, { factor: 1, focus: 'w1' });

        // The leaf would otherwise hang in the gap between the layers.
        expect(apart.some((solid) => solid.elementId === 'dr')).toBe(false);
    });

    it('says nothing about the parts of something with no build-up', () => {
        const document = baseDocument({ elements: [wall('w1', 'conc')] });

        expect(focusedAssembly(document, 'w1')?.layers).toHaveLength(1);
        expect(focusedAssembly(document, null)).toBeNull();
        expect(focusedAssembly(document, 'nothing')).toBeNull();
    });
});
