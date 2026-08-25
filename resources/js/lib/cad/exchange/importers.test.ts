import { describe, expect, it } from 'vitest';
import { cubeTriangles, testDocument } from '@/lib/cad/__fixtures__/document';
import { parseDxf } from '@/lib/cad/exchange/dxf';
import {
    extractTypeLibrary,
    insertDocument,
    insertDxf,
    insertMesh,
    insertTypeLibrary,
    isCadDocument,
    isTypeLibrary,
} from '@/lib/cad/exchange/insert';
import {
    convexHull,
    isBinaryStl,
    MAX_TRIANGLES,
    MeshImportError,
    parseMesh,
    parseObj,
    parseStl,
} from '@/lib/cad/exchange/mesh-import';
import { exportAsciiStl, exportBinaryStl } from '@/lib/cad/exchange/stl';
import { buildSolids } from '@/lib/cad/solids';
import type { MeshElement, WallElement } from '@/lib/cad/types';

const document = testDocument();

function encode(text: string): ArrayBuffer {
    return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

describe('STL import', () => {
    const solids = buildSolids(document, { elementIds: ['column-1'] });

    it('detects binary by length rather than by the word solid', () => {
        expect(isBinaryStl(exportBinaryStl(solids))).toBe(true);
        expect(isBinaryStl(encode(exportAsciiStl(solids)))).toBe(false);
    });

    it('round trips a binary STL back to the same triangle count', () => {
        const mesh = parseStl('column.stl', exportBinaryStl(solids));

        expect(mesh.triangleCount).toBe(12);
        expect(mesh.vertices).toHaveLength(12 * 9);
    });

    it('round trips an ASCII STL', () => {
        const mesh = parseStl('column.stl', encode(exportAsciiStl(solids)));

        expect(mesh.triangleCount).toBe(12);
    });

    it('measures the mesh and centres it on its own footprint', () => {
        const mesh = parseStl('column.stl', exportBinaryStl(solids));

        expect(mesh.size).toEqual({ x: 400, y: 400, z: 3000 });

        const xs = mesh.vertices.filter((_, index) => index % 3 === 0);
        const zs = mesh.vertices.filter((_, index) => index % 3 === 2);

        expect(Math.min(...xs)).toBeCloseTo(-200, 3);
        expect(Math.max(...xs)).toBeCloseTo(200, 3);
        // The base is dropped to zero so it sits on the level.
        expect(Math.min(...zs)).toBe(0);
    });

    it('drops the file extension from the name', () => {
        expect(parseStl('Eames Chair.stl', exportBinaryStl(solids)).name).toBe(
            'Eames Chair',
        );
    });

    it('refuses a mesh over the triangle limit', () => {
        const header = new ArrayBuffer(84);
        new DataView(header).setUint32(80, MAX_TRIANGLES + 1, true);

        // A truncated file, so it is read as ASCII unless the count is honoured.
        const oversized = new ArrayBuffer(84 + (MAX_TRIANGLES + 1) * 50);
        new DataView(oversized).setUint32(80, MAX_TRIANGLES + 1, true);

        expect(() => parseStl('big.stl', oversized)).toThrow(MeshImportError);
    });

    it('rejects a file with no triangles', () => {
        expect(() =>
            parseStl('empty.stl', encode('solid empty\nendsolid empty\n')),
        ).toThrow(MeshImportError);
    });
});

describe('OBJ import', () => {
    it('fan triangulates quads', () => {
        const mesh = parseObj(
            'box.obj',
            [
                'v 0 0 0',
                'v 100 0 0',
                'v 100 100 0',
                'v 0 100 0',
                'f 1 2 3 4',
                '',
            ].join('\n'),
        );

        expect(mesh.triangleCount).toBe(2);
    });

    it('reads face indices with texture and normal parts', () => {
        const mesh = parseObj(
            'box.obj',
            ['v 0 0 0', 'v 100 0 0', 'v 100 100 0', 'f 1/1/1 2/2/2 3/3/3'].join(
                '\n',
            ),
        );

        expect(mesh.triangleCount).toBe(1);
    });

    it('resolves negative indices relative to the end', () => {
        const mesh = parseObj(
            'box.obj',
            ['v 0 0 0', 'v 100 0 0', 'v 100 100 0', 'f -3 -2 -1'].join('\n'),
        );

        expect(mesh.triangleCount).toBe(1);
    });

    it('is picked by extension', () => {
        const mesh = parseMesh(
            'thing.obj',
            encode(['v 0 0 0', 'v 10 0 0', 'v 10 10 0', 'f 1 2 3'].join('\n')),
        );

        expect(mesh.triangleCount).toBe(1);
    });
});

describe('convexHull', () => {
    it('reduces a filled square to its corners', () => {
        const points = [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 0, y: 100 },
            { x: 50, y: 50 },
            { x: 25, y: 75 },
        ];

        expect(convexHull(points)).toHaveLength(4);
    });

    it('leaves a triangle alone', () => {
        const triangle = [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 50, y: 100 },
        ];

        expect(convexHull(triangle)).toHaveLength(3);
    });

    it('wraps a cube footprint in four corners', () => {
        const mesh = parseObj('cube.obj', objFromTriangles(cubeTriangles(600)));

        expect(mesh.footprint).toHaveLength(4);
        expect(mesh.size).toEqual({ x: 600, y: 600, z: 600 });
    });
});

function objFromTriangles(vertices: number[]): string {
    const lines: string[] = [];

    for (let index = 0; index < vertices.length; index += 3) {
        lines.push(
            `v ${vertices[index]} ${vertices[index + 1]} ${vertices[index + 2]}`,
        );
    }

    for (let index = 1; index <= vertices.length / 3; index += 3) {
        lines.push(`f ${index} ${index + 1} ${index + 2}`);
    }

    return lines.join('\n');
}

describe('format detection', () => {
    it('tells a type library from a document', () => {
        expect(isTypeLibrary(extractTypeLibrary(document))).toBe(true);
        expect(isTypeLibrary(document)).toBe(false);
        expect(isCadDocument(document)).toBe(true);
        expect(isCadDocument(extractTypeLibrary(document))).toBe(false);
        expect(isCadDocument(null)).toBe(false);
        expect(isTypeLibrary('nope')).toBe(false);
    });
});

describe('insertTypeLibrary', () => {
    it('adds types that are not already there', () => {
        const result = insertTypeLibrary(document, {
            wallTypes: [
                {
                    id: 'ext-400',
                    name: 'Exterior - 400',
                    thickness: 400,
                    function: 'exterior',
                },
            ],
        });

        expect(result.document.wallTypes).toHaveLength(3);
        expect(result.summary.added).toEqual(['1 wall types']);
    });

    it('is a no-op when the same library is imported twice', () => {
        const once = insertTypeLibrary(document, extractTypeLibrary(document));

        expect(once.document.wallTypes).toHaveLength(2);
        expect(once.summary.added).toEqual(['nothing new']);
    });
});

describe('insertDocument', () => {
    it('replaces the model outright', () => {
        const other = testDocument({ elements: [] });
        const result = insertDocument(document, other, 'replace', 'level-1');

        expect(result.document.elements).toHaveLength(0);
    });

    it('merges onto a level with fresh ids', () => {
        const result = insertDocument(document, document, 'merge', 'level-2');
        const merged = result.document.elements.slice(document.elements.length);

        expect(merged).toHaveLength(document.elements.length);
        expect(merged.every((element) => element.level === 'level-2')).toBe(
            true,
        );

        const originalIds = new Set(
            document.elements.map((element) => element.id),
        );

        expect(merged.some((element) => originalIds.has(element.id))).toBe(
            false,
        );
    });

    it('rehosts merged openings onto the merged wall', () => {
        const result = insertDocument(document, document, 'merge', 'level-2');
        const merged = result.document.elements.slice(document.elements.length);
        const walls = new Set(
            merged
                .filter((element) => element.kind === 'wall')
                .map((element) => element.id),
        );
        const openings = merged.filter(
            (element) => element.kind === 'door' || element.kind === 'window',
        );

        expect(openings).toHaveLength(2);
        openings.forEach((opening) => {
            expect(walls.has((opening as { host: string }).host)).toBe(true);
        });
    });

    it('drops an opening whose host did not come across', () => {
        const orphan = testDocument({
            elements: [
                {
                    id: 'door-x',
                    kind: 'door',
                    level: 'level-1',
                    typeId: 'door-900',
                    host: 'missing-wall',
                    t: 0.5,
                    flipFace: false,
                    flipHand: false,
                },
            ],
        });

        const result = insertDocument(document, orphan, 'merge', 'level-1');

        expect(result.document.elements).toHaveLength(document.elements.length);
    });
});

describe('insertDxf', () => {
    const drawing = parseDxf(
        [
            '0',
            'SECTION',
            '2',
            'ENTITIES',
            '0',
            'LINE',
            '8',
            'WALLS',
            '10',
            '0.0',
            '20',
            '0.0',
            '11',
            '5000.0',
            '21',
            '0.0',
            '0',
            'LWPOLYLINE',
            '8',
            'SITE',
            '90',
            '3',
            '70',
            '1',
            '10',
            '0.0',
            '20',
            '0.0',
            '10',
            '1000.0',
            '20',
            '0.0',
            '10',
            '1000.0',
            '20',
            '1000.0',
            '0',
            'ENDSEC',
            '0',
            'EOF',
            '',
        ].join('\r\n'),
    );

    const options = {
        levelId: 'level-1',
        wallTypeId: 'ext-300',
        wallHeight: 3000,
        locationLine: 'center',
    } as const;

    it('reads both line and polyline entities with their layers', () => {
        expect(drawing.polylines).toHaveLength(2);
        expect(drawing.layers).toEqual(['SITE', 'WALLS']);
    });

    it('closes a closed polyline back to its first point', () => {
        const result = insertDxf(document, drawing.polylines, {
            ...options,
            as: 'lines',
        });
        const added = result.document.elements.slice(document.elements.length);

        // One segment from the LINE, three from the closed triangle.
        expect(added).toHaveLength(4);
    });

    it('builds walls with the chosen type and height', () => {
        const result = insertDxf(document, drawing.polylines, {
            ...options,
            as: 'walls',
            layers: ['WALLS'],
        });
        const added = result.document.elements.slice(
            document.elements.length,
        ) as WallElement[];

        expect(added).toHaveLength(1);
        expect(added[0].kind).toBe('wall');
        expect(added[0].typeId).toBe('ext-300');
        expect(added[0].height).toBe(3000);
        expect(added[0].b).toEqual({ x: 5000, y: 0 });
    });

    it('filters to the chosen layers', () => {
        const result = insertDxf(document, drawing.polylines, {
            ...options,
            as: 'lines',
            layers: ['SITE'],
        });

        expect(result.document.elements).toHaveLength(
            document.elements.length + 3,
        );
    });

    it('applies an extra scale and offset', () => {
        const result = insertDxf(document, drawing.polylines, {
            ...options,
            as: 'walls',
            layers: ['WALLS'],
            scale: 2,
            offset: { x: 100, y: 50 },
        });
        const added = result.document.elements.slice(
            document.elements.length,
        ) as WallElement[];

        expect(added[0].a).toEqual({ x: 100, y: 50 });
        expect(added[0].b).toEqual({ x: 10_100, y: 50 });
    });

    it('honours the drawing units when they are metres', () => {
        const metres = parseDxf(
            [
                '0',
                'SECTION',
                '2',
                'HEADER',
                '9',
                '$INSUNITS',
                '70',
                '6',
                '0',
                'ENDSEC',
                '0',
                'SECTION',
                '2',
                'ENTITIES',
                '0',
                'LINE',
                '8',
                'A',
                '10',
                '0.0',
                '20',
                '0.0',
                '11',
                '5.0',
                '21',
                '0.0',
                '0',
                'ENDSEC',
                '0',
                'EOF',
                '',
            ].join('\r\n'),
        );

        expect(metres.unitScale).toBe(1000);
        expect(metres.polylines[0].points[1]).toEqual({ x: 5000, y: 0 });
    });

    it('discards segments too short to be real geometry', () => {
        const noise = parseDxf(
            [
                '0',
                'SECTION',
                '2',
                'ENTITIES',
                '0',
                'LINE',
                '8',
                'A',
                '10',
                '0.0',
                '20',
                '0.0',
                '11',
                '2.0',
                '21',
                '0.0',
                '0',
                'ENDSEC',
                '0',
                'EOF',
                '',
            ].join('\r\n'),
        );

        const result = insertDxf(document, noise.polylines, {
            ...options,
            as: 'walls',
        });

        expect(result.document.elements).toHaveLength(document.elements.length);
    });
});

describe('insertMesh', () => {
    it('places a mesh element carrying its triangles and footprint', () => {
        const mesh = parseObj('cube.obj', objFromTriangles(cubeTriangles(600)));
        const result = insertMesh(document, mesh, {
            levelId: 'level-1',
            at: { x: 2000, y: 1000 },
            scale: 1,
        });

        const placed = result.document.elements.at(-1) as MeshElement;

        expect(placed.kind).toBe('mesh');
        expect(placed.name).toBe('cube');
        expect(placed.p).toEqual({ x: 2000, y: 1000 });
        expect(placed.vertices).toHaveLength(mesh.triangleCount * 9);
        expect(result.summary.ids).toEqual([placed.id]);
    });

    it('turns into solids that the exporters can write', () => {
        const mesh = parseObj('cube.obj', objFromTriangles(cubeTriangles(600)));
        const withMesh = insertMesh(document, mesh, {
            levelId: 'level-1',
            at: { x: 2000, y: 1000 },
            scale: 2,
        }).document;

        const solid = buildSolids(withMesh).find(
            (item) => item.category === 'mesh',
        );

        expect(solid?.faces).toHaveLength(12);
        // Scaled by two and moved to the insertion point.
        const xs = solid?.faces.flat().map((vertex) => vertex.x) ?? [];

        expect(Math.min(...xs)).toBeCloseTo(2000 - 600, 0);
        expect(Math.max(...xs)).toBeCloseTo(2000 + 600, 0);
    });
});
