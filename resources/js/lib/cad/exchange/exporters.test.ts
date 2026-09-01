import { describe, expect, it } from 'vitest';
import { testDocument } from '@/lib/cad/__fixtures__/document';
import {
    buildExport,
    describeExtents,
    EXPORT_FORMATS,
    solidsForExport,
} from '@/lib/cad/exchange';
import { exportCollada } from '@/lib/cad/exchange/collada';
import { exportDxf, parseDxf } from '@/lib/cad/exchange/dxf';
import { exportGltf } from '@/lib/cad/exchange/gltf';
import { exportObj } from '@/lib/cad/exchange/obj';
import { exportPly } from '@/lib/cad/exchange/ply';
import { exportStep } from '@/lib/cad/exchange/step';
import {
    countStlTriangles,
    exportAsciiStl,
    exportBinaryStl,
} from '@/lib/cad/exchange/stl';
import { exportSvg } from '@/lib/cad/exchange/svg';
import { buildSolids } from '@/lib/cad/solids';

const document = testDocument();
const solids = buildSolids(document);

describe('STL', () => {
    it('writes a binary file of exactly the right length', () => {
        const buffer = exportBinaryStl(solids, { name: 'test' });
        const triangles = countStlTriangles(solids);

        expect(buffer.byteLength).toBe(84 + triangles * 50);
        expect(new DataView(buffer).getUint32(80, true)).toBe(triangles);
    });

    it('keeps the header inside 80 bytes', () => {
        const view = new DataView(
            exportBinaryStl(solids, { name: 'a'.repeat(300) }),
        );

        // Byte 80 onwards is the triangle count, not spilled header text.
        expect(view.getUint32(80, true)).toBe(countStlTriangles(solids));
    });

    it('writes one ASCII facet per triangle with unit normals', () => {
        const ascii = exportAsciiStl(solids, { name: 'test' });
        const facets = ascii.match(/facet normal/g) ?? [];

        expect(facets).toHaveLength(countStlTriangles(solids));
        expect(ascii.startsWith('solid test')).toBe(true);
        expect(ascii.trimEnd().endsWith('endsolid test')).toBe(true);

        const normals = [...ascii.matchAll(/facet normal (\S+) (\S+) (\S+)/g)];

        normals.forEach(([, x, y, z]) => {
            const length = Math.hypot(
                Number.parseFloat(x),
                Number.parseFloat(y),
                Number.parseFloat(z),
            );

            expect(length).toBeCloseTo(1, 3);
        });
    });

    it('agrees between the ASCII and binary writers', () => {
        const ascii = exportAsciiStl(solids).match(/facet normal/g) ?? [];
        const binary = new DataView(exportBinaryStl(solids)).getUint32(
            80,
            true,
        );

        expect(ascii.length).toBe(binary);
    });
});

describe('STEP', () => {
    const step = exportStep(solids, {
        name: 'test',
        timestamp: '2026-01-01T00:00:00',
    });

    it('is a well formed part 21 file', () => {
        expect(step.startsWith('ISO-10303-21;')).toBe(true);
        expect(step.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
        expect(step).toContain('FILE_SCHEMA');
        expect(step).toContain('ADVANCED_BREP_SHAPE_REPRESENTATION');
    });

    it('defines every entity it references', () => {
        const defined = new Set(
            [...step.matchAll(/^#(\d+) = /gm)].map((match) => Number(match[1])),
        );
        const referenced = new Set(
            [...step.matchAll(/#(\d+)/g)].map((match) => Number(match[1])),
        );
        const dangling = [...referenced].filter((id) => !defined.has(id));

        expect(dangling).toEqual([]);
    });

    it('numbers entities without gaps or repeats', () => {
        const ids = [...step.matchAll(/^#(\d+) = /gm)].map((match) =>
            Number(match[1]),
        );

        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toEqual(ids.map((_, index) => index + 1));
    });

    it('writes one closed shell per solid', () => {
        expect(step.match(/CLOSED_SHELL/g) ?? []).toHaveLength(solids.length);
        expect(step.match(/MANIFOLD_SOLID_BREP/g) ?? []).toHaveLength(
            solids.length,
        );
    });

    it('shares an edge between the two faces that use it', () => {
        const edges = (step.match(/EDGE_CURVE/g) ?? []).length;
        const orientedEdges = (step.match(/ORIENTED_EDGE/g) ?? []).length;

        // Every edge of a closed shell is traversed twice, so oriented edges
        // must outnumber edge curves roughly two to one.
        expect(orientedEdges).toBeGreaterThan(edges);
        expect(orientedEdges / edges).toBeCloseTo(2, 0);
    });

    it('writes reals with a decimal point', () => {
        const points = [...step.matchAll(/CARTESIAN_POINT\('',\(([^)]+)\)\)/g)];

        expect(points.length).toBeGreaterThan(0);

        points.forEach(([, body]) => {
            body.split(',').forEach((value) => {
                expect(value.trim()).toMatch(/\./);
            });
        });
    });

    it('declares millimetres', () => {
        expect(step).toContain('SI_UNIT(.MILLI.,.METRE.)');
    });
});

describe('OBJ', () => {
    const { obj, mtl } = exportObj(solids, 'test');

    it('references only vertices it has written', () => {
        const vertices = (obj.match(/^v /gm) ?? []).length;
        const indices = [...obj.matchAll(/^f (.+)$/gm)].flatMap((match) =>
            match[1].split(/\s+/).map(Number),
        );

        expect(indices.length).toBeGreaterThan(0);
        expect(Math.min(...indices)).toBeGreaterThanOrEqual(1);
        expect(Math.max(...indices)).toBeLessThanOrEqual(vertices);
    });

    it('writes one object per solid', () => {
        expect(obj.match(/^o /gm) ?? []).toHaveLength(solids.length);
    });

    it('keeps faces as polygons rather than triangulating', () => {
        const quads = [...obj.matchAll(/^f (.+)$/gm)].filter(
            (match) => match[1].split(/\s+/).length === 4,
        );

        expect(quads.length).toBeGreaterThan(0);
    });

    it('ships a material for every category it used', () => {
        expect(obj).toContain('mtllib test.mtl');
        expect(mtl).toContain('newmtl VH_Wall');
        expect(mtl).toContain('newmtl VH_Floor');
        // Glazing is the one material that is not opaque.
        expect(mtl).toContain('d 0.550000');
    });
});

describe('DXF', () => {
    const dxf = exportDxf(document, 'level-1');

    it('opens and closes the required sections', () => {
        expect(dxf).toContain('SECTION');
        expect(dxf).toContain('ENTITIES');
        expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
    });

    it('puts exterior and interior walls on their own layers', () => {
        expect(dxf).toContain('AX-WALL-EXTERIOR');
        expect(dxf).toContain('AX-WALL-INTERIOR');
    });

    it('round trips its own polylines', () => {
        const drawing = parseDxf(dxf);
        const walls = drawing.polylines.filter((polyline) =>
            polyline.layer.startsWith('AX-WALL'),
        );

        // Five walls in the fixture, each a closed footprint.
        expect(walls).toHaveLength(5);
        walls.forEach((wall) => {
            expect(wall.closed).toBe(true);
            expect(wall.points).toHaveLength(4);
        });
    });

    it('round trips coordinates to within a rounding step', () => {
        const drawing = parseDxf(dxf);
        const xs = drawing.polylines.flatMap((polyline) =>
            polyline.points.map((p) => p.x),
        );

        expect(Math.min(...xs)).toBeCloseTo(-150, 1);
        expect(Math.max(...xs)).toBeCloseTo(6150, 1);
    });

    it('annotates the room with its name and area', () => {
        expect(dxf).toContain('Living 101');
        expect(dxf).toContain('AX-ROOM');
    });
});

describe('buildExport', () => {
    const base = { document, levelId: 'level-1', name: 'Kits House' } as const;

    it('names files from the project and format', () => {
        expect(
            buildExport({ ...base, format: 'step', scope: 'model' }).files[0]
                .filename,
        ).toBe('kits-house.step');
        expect(
            buildExport({ ...base, format: 'stl', scope: 'model' }).files[0]
                .filename,
        ).toBe('kits-house.stl');
    });

    it('writes OBJ alongside its material library', () => {
        const result = buildExport({ ...base, format: 'obj', scope: 'model' });

        expect(result.files.map((file) => file.filename)).toEqual([
            'kits-house.obj',
            'kits-house.mtl',
        ]);
    });

    it('exports the native document verbatim', () => {
        const result = buildExport({ ...base, format: 'json', scope: 'model' });

        expect(JSON.parse(result.files[0].data as string)).toEqual(document);
    });

    it('narrows a selection scope to the chosen elements', () => {
        const result = buildExport({
            ...base,
            format: 'stl',
            scope: 'selection',
            selection: ['column-1'],
        });

        expect(result.solids).toBe(1);
        // A box is six quads, so twelve triangles.
        expect(result.triangles).toBe(12);
    });

    it('produces nothing for an empty selection', () => {
        const result = buildExport({
            ...base,
            format: 'stl',
            scope: 'selection',
            selection: [],
        });

        expect(result.solids).toBe(0);
        expect(result.triangles).toBe(0);
    });

    it('converts to Y up on request without turning solids inside out', () => {
        const zUp = solidsForExport({ ...base, format: 'stl', scope: 'model' });
        const yUp = solidsForExport({
            ...base,
            format: 'stl',
            scope: 'model',
            upAxis: 'y',
        });

        expect(yUp).toHaveLength(zUp.length);

        const first = zUp[0].faces[0][0];
        const turned = yUp[0].faces[0][0];

        expect(turned.y).toBeCloseTo(first.z, 6);
        expect(turned.z).toBeCloseTo(-first.y, 6);
    });

    it('reports the extents of what will be written', () => {
        expect(
            describeExtents({ ...base, format: 'stl', scope: 'model' }),
        ).toBe('6,300 × 4,300 × 3,200 mm');
    });
});

/* ------------------------------------------------------ the newer formats */

describe('glTF', () => {
    const gltf = JSON.parse(exportGltf(solids, { name: 'test' })) as {
        asset: { version: string };
        scenes: { nodes: number[] }[];
        meshes: { name: string; primitives: { attributes: { POSITION: number } }[] }[];
        accessors: { count: number; type: string; min?: number[]; max?: number[] }[];
        buffers: { byteLength: number; uri: string }[];
        materials: unknown[];
    };

    it('says which version of the format it is', () => {
        expect(gltf.asset.version).toBe('2.0');
    });

    it('carries its geometry inside the one file', () => {
        expect(gltf.buffers).toHaveLength(1);
        expect(gltf.buffers[0].uri.startsWith('data:application/octet-stream;base64,')).toBe(
            true,
        );
        expect(gltf.buffers[0].byteLength).toBeGreaterThan(0);
    });

    it('groups the model into named parts rather than one node each', () => {
        expect(gltf.meshes.length).toBeGreaterThan(1);
        expect(gltf.meshes.map((mesh) => mesh.name)).toContain('wall');
        // A mesh per category, not a mesh per solid.
        expect(gltf.meshes.length).toBeLessThan(solids.length);
    });

    it('bounds every position accessor, as viewers need to frame it', () => {
        const positions = gltf.accessors.filter(
            (accessor) => accessor.type === 'VEC3',
        );

        expect(positions.length).toBeGreaterThan(0);

        positions.forEach((accessor) => {
            expect(accessor.min).toHaveLength(3);
            expect(accessor.max).toHaveLength(3);
            accessor.min?.forEach((value) => expect(Number.isFinite(value)).toBe(true));
        });
    });

    it('gives every part a material', () => {
        expect(gltf.materials).toHaveLength(gltf.meshes.length);
    });

    it('turns the model Y-up, which is what glTF viewers assume', () => {
        const zUp = JSON.parse(exportGltf(solids, { upAxis: 'z' })) as typeof gltf;

        // The same model, different axes: the buffers cannot match.
        expect(zUp.buffers[0].uri).not.toBe(gltf.buffers[0].uri);
    });
});

describe('PLY', () => {
    const ply = exportPly(solids);
    const lines = ply.split('\n');

    it('writes a header that matches the body', () => {
        const vertices = Number(
            /element vertex (\d+)/.exec(ply)?.[1] ?? '0',
        );
        const faces = Number(/element face (\d+)/.exec(ply)?.[1] ?? '0');
        const start = lines.indexOf('end_header') + 1;

        expect(vertices).toBeGreaterThan(0);
        expect(faces).toBe(vertices / 3);
        // Every row the header promised, and no more.
        expect(lines.slice(start).filter((line) => line !== '')).toHaveLength(
            vertices + faces,
        );
    });

    it('carries colour, which is what STL cannot', () => {
        expect(ply).toContain('property uchar red');

        const start = lines.indexOf('end_header') + 1;

        expect(lines[start].split(' ')).toHaveLength(6);
    });
});

describe('COLLADA', () => {
    const dae = exportCollada(solids, { name: 'test', timestamp: 'now' });

    it('is a COLLADA document', () => {
        expect(dae).toContain('<COLLADA');
        expect(dae).toContain('version="1.4.1"');
    });

    it('says it is in millimetres, so SketchUp does not guess', () => {
        expect(dae).toContain('<unit meter="0.001" name="millimeter"/>');
        expect(dae).toContain('<up_axis>Z_UP</up_axis>');
    });

    it('gives each geometry a material and each material an effect', () => {
        const geometries = (dae.match(/<geometry /g) ?? []).length;

        expect(geometries).toBeGreaterThan(0);
        expect((dae.match(/<material /g) ?? []).length).toBe(geometries);
        expect((dae.match(/<effect /g) ?? []).length).toBe(geometries);
    });

    it('counts its triangles rather than its corners', () => {
        const [, count] = /<triangles count="(\d+)"/.exec(dae) ?? [];
        const [, floats] = /<float_array [^>]*count="(\d+)"/.exec(dae) ?? [];

        // Three vertices of three floats to a triangle.
        expect(Number(floats)).toBe(Number(count) * 9);
    });
});

describe('SVG', () => {
    const svg = exportSvg(document, { levelId: 'level-1', name: 'Plan' });

    it('is a standalone drawing with a real size on the page', () => {
        expect(svg).toContain('<svg');
        expect(svg).toMatch(/width="[\d.]+mm"/);
        expect(svg).toContain('viewBox=');
    });

    it('draws the walls as poché and cuts the openings out of them', () => {
        // Solid wall bodies, then white where the door and window are.
        expect((svg.match(/fill="#2b2926"/g) ?? []).length).toBeGreaterThan(0);
        expect((svg.match(/fill="#ffffff"/g) ?? []).length).toBeGreaterThan(1);
    });

    it('flips the plan, because SVG counts down the page and north is up', () => {
        // The fixture runs from y=0 to y=4000; upside down that is -4000..0.
        expect(svg).toMatch(/viewBox="[-\d. ]*-4[\d.]+/);
    });

    it('labels the rooms', () => {
        expect(svg).toContain('<text');
    });

    it('gives an empty level a valid file rather than a broken one', () => {
        const blank = exportSvg(
            { ...document, elements: [] },
            { levelId: 'level-1' },
        );

        expect(blank).toContain('<svg');
        expect(blank).toContain('</svg>');
    });
});

describe('the format registry', () => {
    const base = { document, levelId: 'level-1', name: 'Kits House' } as const;

    it('offers every format the dialog lists, and builds each one', () => {
        EXPORT_FORMATS.forEach((format) => {
            const built = buildExport({
                ...base,
                format: format.id,
                scope: 'model',
            });

            expect(built.files.length).toBeGreaterThan(0);
            expect(built.bytes).toBeGreaterThan(0);
            expect(built.files[0].filename).toBe(
                `kits-house.${format.extension}`,
            );
        });
    });

    it('has no two formats sharing an id', () => {
        const ids = EXPORT_FORMATS.map((format) => format.id);

        expect(new Set(ids).size).toBe(ids.length);
    });
});
