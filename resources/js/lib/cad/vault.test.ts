import { describe, expect, it } from 'vitest';
import { testDocument } from '@/lib/cad/__fixtures__/document';
import { buildModelFaces } from '@/lib/cad/mesh';
import {
    buildClientModel,
    buildPreview,
    summarise,
} from '@/lib/cad/preview';
import type {
    CadDocument,
    FloorElement,
    MeshElement,
    WallElement,
} from '@/lib/cad/types';
import { memoryVault, newerRecord, toRecord } from '@/lib/cad/vault';

function documentWith(elements: CadDocument['elements']): CadDocument {
    return {
        version: 1,
        units: 'metric',
        levels: [
            { id: 'level-1', name: 'Level 1', elevation: 0 },
            { id: 'level-2', name: 'Level 2', elevation: 3000 },
        ],
        wallTypes: [
            {
                id: 'generic-200',
                name: 'Generic - 200mm',
                thickness: 200,
                function: 'exterior',
            },
        ],
        doorTypes: [],
        windowTypes: [],
        elements,
        viewSettings: { 'plan:level-1': { scale: 50 } } as never,
    };
}

function wall(id: string, level: string, length: number): WallElement {
    return {
        id,
        kind: 'wall',
        level,
        typeId: 'generic-200',
        a: { x: 0, y: 0 },
        b: { x: length, y: 0 },
        height: 3000,
        baseOffset: 0,
        locationLine: 'center',
    };
}

describe('the local vault', () => {
    it('hands back what was put in', async () => {
        const vault = memoryVault();
        const document = documentWith([wall('w1', 'level-1', 4000)]);

        await vault.write(7, document, 3);
        const held = await vault.read(7);

        expect(held?.projectId).toBe(7);
        expect(held?.revision).toBe(3);
        expect(held?.document.elements).toHaveLength(1);
        expect(held?.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('knows nothing about a drawing it has never held', async () => {
        expect(await memoryVault().read(99)).toBeNull();
    });

    it('lists which drawings are on this computer', async () => {
        const vault = memoryVault();

        await vault.write(4, documentWith([]), 1);
        await vault.write(2, documentWith([]), 1);

        expect(await vault.list()).toEqual([2, 4]);

        await vault.forget(4);

        expect(await vault.list()).toEqual([2]);
    });

    it('overwrites rather than duplicating on the second save', async () => {
        const vault = memoryVault();

        await vault.write(1, documentWith([wall('w1', 'level-1', 1000)]), 1);
        await vault.write(
            1,
            documentWith([
                wall('w1', 'level-1', 1000),
                wall('w2', 'level-1', 2000),
            ]),
            2,
        );

        expect(await vault.list()).toEqual([1]);
        expect((await vault.read(1))?.document.elements).toHaveLength(2);
    });
});

describe('newerRecord', () => {
    const at = (revision: number, savedAt: string) => ({
        ...toRecord(1, documentWith([]), revision, new Date(savedAt)),
    });

    it('prefers the copy with more edits behind it', () => {
        const older = at(4, '2026-01-02T00:00:00.000Z');
        const newer = at(9, '2026-01-01T00:00:00.000Z');

        // Later clock, fewer edits — the edit count is what counts.
        expect(newerRecord(older, newer)).toBe(newer);
    });

    it('breaks a tie on the clock', () => {
        const first = at(5, '2026-01-01T00:00:00.000Z');
        const second = at(5, '2026-01-02T00:00:00.000Z');

        expect(newerRecord(first, second)).toBe(second);
    });

    it('treats a missing copy as always losing', () => {
        const only = at(1, '2026-01-01T00:00:00.000Z');

        expect(newerRecord(null, only)).toBe(only);
        expect(newerRecord(only, null)).toBe(only);
        expect(newerRecord(null, null)).toBeNull();
    });
});

describe('what the server keeps', () => {
    it('previews the busiest level only', () => {
        const preview = buildPreview(
            documentWith([
                wall('a', 'level-1', 1000),
                wall('b', 'level-2', 1000),
                wall('c', 'level-2', 1000),
                wall('d', 'level-2', 1000),
            ]),
        )!;

        expect(preview.levels).toHaveLength(1);
        expect(preview.levels[0].id).toBe('level-2');
        expect(preview.elements).toHaveLength(3);
    });

    it('strips mesh triangles, which are the bulk of a document', () => {
        const mesh: MeshElement = {
            id: 'm1',
            kind: 'mesh',
            level: 'level-1',
            name: 'Site scan',
            p: { x: 0, y: 0 },
            rotation: 0,
            scale: 1,
            baseOffset: 0,
            // A modest scan: 5,000 triangles, three vertices each.
            vertices: Array.from({ length: 45_000 }, (_, i) => i),
            footprint: [
                { x: 0, y: 0 },
                { x: 1000, y: 0 },
                { x: 1000, y: 1000 },
            ],
            size: { x: 1000, y: 1000, z: 500 },
        };

        const preview = buildPreview(documentWith([mesh]))!;
        const kept = preview.elements[0] as MeshElement;

        expect(kept.vertices).toHaveLength(0);
        // The preview must be a fraction of the model it came from.
        expect(JSON.stringify(preview).length).toBeLessThan(
            JSON.stringify(documentWith([mesh])).length / 10,
        );
    });

    it('has nothing to preview before anything is drawn', () => {
        expect(buildPreview(documentWith([]))).toBeNull();
    });

    it('keeps every level in the client model, not just the busiest', () => {
        // The portal walks the whole house, so the one-level preview above is
        // not enough to serve it.
        const house = buildClientModel(
            documentWith([
                wall('a', 'level-1', 1000),
                wall('b', 'level-2', 1000),
                wall('c', 'level-2', 1000),
            ]),
        )!;

        expect(house.levels).toHaveLength(2);
        expect(house.elements).toHaveLength(3);
    });

    it('leaves the drafting out of the client model', () => {
        const house = buildClientModel(
            documentWith([
                wall('a', 'level-1', 1000),
                {
                    id: 'd1',
                    kind: 'dimension',
                    level: 'level-1',
                    a: { x: 0, y: 0 },
                    b: { x: 1000, y: 0 },
                    offset: 500,
                } as never,
                {
                    id: 'g1',
                    kind: 'grid',
                    level: 'level-1',
                    label: 'A',
                    a: { x: 0, y: 0 },
                    b: { x: 1000, y: 0 },
                } as never,
            ]),
        )!;

        expect(house.elements.map((element) => element.id)).toEqual(['a']);
    });

    it('leaves imported meshes out of the client model on size', () => {
        const mesh: MeshElement = {
            id: 'm1',
            kind: 'mesh',
            level: 'level-1',
            name: 'Site scan',
            p: { x: 0, y: 0 },
            rotation: 0,
            scale: 1,
            baseOffset: 0,
            vertices: Array.from({ length: 45_000 }, (_, i) => i),
            footprint: [
                { x: 0, y: 0 },
                { x: 1000, y: 0 },
                { x: 1000, y: 1000 },
            ],
            size: { x: 1000, y: 1000, z: 500 },
        };

        const house = buildClientModel(
            documentWith([wall('a', 'level-1', 1000), mesh]),
        )!;

        expect(house.elements.map((element) => element.id)).toEqual(['a']);
    });

    it('has no house to send before anything is built', () => {
        expect(buildClientModel(documentWith([]))).toBeNull();
    });

    it('still builds into solids after the drafting is stripped out', () => {
        // The portal draws the client model through the same solid builder
        // the editor uses. Dropping an element kind it depends on would leave
        // the client staring at an empty screen, which no assertion about
        // element counts would catch.
        const house = buildClientModel(testDocument())!;
        const faces = buildModelFaces(house);

        expect(faces.length).toBeGreaterThan(0);

        const coordinates = faces.flatMap((face) =>
            face.vertices.flatMap((vertex) => [vertex.x, vertex.y, vertex.z]),
        );

        expect(coordinates.every(Number.isFinite)).toBe(true);
    });

    it('counts the whole model, not the previewed level', () => {
        const floor: FloorElement = {
            id: 'f1',
            kind: 'floor',
            level: 'level-1',
            points: [
                { x: 0, y: 0 },
                { x: 4000, y: 0 },
                { x: 4000, y: 3000 },
                { x: 0, y: 3000 },
            ],
            thickness: 200,
            offset: 0,
        };

        const summary = summarise(
            documentWith([
                wall('a', 'level-1', 5000),
                wall('b', 'level-2', 3000),
                floor,
            ]),
        );

        expect(summary.levels).toBe(2);
        expect(summary.walls).toBe(2);
        // Both levels counted, even though only one is previewed.
        expect(summary.wallLength).toBeCloseTo(8000);
        expect(summary.slabArea).toBeCloseTo(12_000_000);
    });
});
