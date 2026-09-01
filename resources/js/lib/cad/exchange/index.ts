import { exportCollada } from '@/lib/cad/exchange/collada';
import { exportDxf } from '@/lib/cad/exchange/dxf';
import { exportGltf } from '@/lib/cad/exchange/gltf';
import { exportIfc } from '@/lib/cad/exchange/ifc';
import { exportObj } from '@/lib/cad/exchange/obj';
import { exportPly } from '@/lib/cad/exchange/ply';
import { exportStep } from '@/lib/cad/exchange/step';
import {
    countStlTriangles,
    exportAsciiStl,
    exportBinaryStl,
} from '@/lib/cad/exchange/stl';
import { exportSvg } from '@/lib/cad/exchange/svg';
import { buildSolids, boundsOfSolids } from '@/lib/cad/solids';
import type { Solid, Vec3 } from '@/lib/cad/solids';
import type { CadDocument } from '@/lib/cad/types';

export type ExportFormatId =
    | 'ifc'
    | 'step'
    | 'stl'
    | 'stl-ascii'
    | 'obj'
    | 'gltf'
    | 'collada'
    | 'ply'
    | 'dxf'
    | 'svg'
    | 'json';

export type ExportScopeId = 'model' | 'level' | 'selection';

export type UpAxis = 'z' | 'y';

export type ExportOptions = {
    document: CadDocument;
    format: ExportFormatId;
    scope: ExportScopeId;
    /** Level used by the `level` scope and by every DXF export. */
    levelId: string;
    /** Elements used by the `selection` scope. */
    selection?: string[];
    name?: string;
    upAxis?: UpAxis;
    /** Passed in rather than read from the clock so exports are reproducible. */
    timestamp?: string;
};

export type ExportFile = {
    filename: string;
    mime: string;
    data: string | ArrayBuffer;
};

export type ExportResult = {
    files: ExportFile[];
    solids: number;
    triangles: number;
    bytes: number;
};

export type ExportFormat = {
    id: ExportFormatId;
    label: string;
    extension: string;
    /** One line describing what the format is good for. */
    description: string;
    /** 3D formats work on solids; 2D formats work on the plan. */
    dimension: '2d' | '3d' | 'data';
};

export const EXPORT_FORMATS: ExportFormat[] = [
    {
        id: 'ifc',
        label: 'IFC 4',
        extension: 'ifc',
        description:
            'The BIM exchange format — opens in Revit, ArchiCAD and Solibri, classified.',
        dimension: '3d',
    },
    {
        id: 'step',
        label: 'STEP (AP214)',
        extension: 'step',
        description: 'Solid B-rep for engineering CAD — editable, not a mesh.',
        dimension: '3d',
    },
    {
        id: 'stl',
        label: 'STL (binary)',
        extension: 'stl',
        description: 'Triangle mesh for 3D printing and rapid visualisation.',
        dimension: '3d',
    },
    {
        id: 'stl-ascii',
        label: 'STL (ASCII)',
        extension: 'stl',
        description:
            'The same mesh in readable text — larger, easier to inspect.',
        dimension: '3d',
    },
    {
        id: 'obj',
        label: 'OBJ + MTL',
        extension: 'obj',
        description:
            'Polygons with materials for Blender, three.js and renderers.',
        dimension: '3d',
    },
    {
        id: 'gltf',
        label: 'glTF 2.0',
        extension: 'gltf',
        description:
            'One file the web opens: browser viewers, phone AR, model hosts.',
        dimension: '3d',
    },
    {
        id: 'collada',
        label: 'COLLADA',
        extension: 'dae',
        description: 'The way into SketchUp and the older end of the toolchain.',
        dimension: '3d',
    },
    {
        id: 'ply',
        label: 'PLY',
        extension: 'ply',
        description:
            'Coloured triangle mesh for MeshLab, CloudCompare and scanning tools.',
        dimension: '3d',
    },
    {
        id: 'dxf',
        label: 'DXF (plan)',
        extension: 'dxf',
        description: 'The current level as layered 2D geometry for AutoCAD.',
        dimension: '2d',
    },
    {
        id: 'svg',
        label: 'SVG (plan)',
        extension: 'svg',
        description:
            'The plan as vector art for a report, a letter or Illustrator.',
        dimension: '2d',
    },
    {
        id: 'json',
        label: 'Vanhaven model',
        extension: 'json',
        description:
            'The whole document, for backup or moving between projects.',
        dimension: 'data',
    },
];

export const EXPORT_SCOPES: {
    id: ExportScopeId;
    label: string;
    description: string;
}[] = [
    {
        id: 'model',
        label: 'Entire model',
        description: 'Every level in the project',
    },
    {
        id: 'level',
        label: 'Current level',
        description: 'Just what is on the open plan',
    },
    {
        id: 'selection',
        label: 'Selection',
        description: 'Only the elements selected',
    },
];

export function formatById(id: ExportFormatId): ExportFormat {
    return (
        EXPORT_FORMATS.find((format) => format.id === id) ?? EXPORT_FORMATS[0]
    );
}

/**
 * Resolve the export scope into the solids that will be written.
 */
export function solidsForExport(options: ExportOptions): Solid[] {
    const solids = buildSolids(options.document, {
        levels: options.scope === 'level' ? [options.levelId] : undefined,
        elementIds:
            options.scope === 'selection'
                ? (options.selection ?? [])
                : undefined,
    });

    return options.upAxis === 'y' ? solids.map(toYUp) : solids;
}

/**
 * Rotate a solid from the model's Z-up frame into the Y-up frame that mesh
 * tools expect, keeping the winding by mirroring nothing — this is a rotation
 * about X, so normals come along unchanged.
 */
function toYUp(solid: Solid): Solid {
    const turn = (vertex: Vec3): Vec3 => ({
        x: vertex.x,
        y: vertex.z,
        z: -vertex.y,
    });

    return { ...solid, faces: solid.faces.map((face) => face.map(turn)) };
}

export function buildExport(options: ExportOptions): ExportResult {
    const name = sanitise(options.name ?? 'model');
    const format = formatById(options.format);

    if (format.id === 'json') {
        const data = JSON.stringify(options.document, null, 2);

        return single(
            { filename: `${name}.json`, mime: 'application/json', data },
            0,
            0,
        );
    }

    if (format.id === 'dxf') {
        const data = exportDxf(options.document, options.levelId);

        return single(
            { filename: `${name}.dxf`, mime: 'image/vnd.dxf', data },
            0,
            0,
        );
    }

    if (format.id === 'svg') {
        const data = exportSvg(options.document, {
            levelId: options.levelId,
            name: options.name,
        });

        return single(
            { filename: `${name}.svg`, mime: 'image/svg+xml', data },
            0,
            0,
        );
    }

    const solids = solidsForExport(options);
    const triangles = countStlTriangles(solids);

    if (format.id === 'ifc') {
        const data = exportIfc(solids, { name, timestamp: options.timestamp });

        return single(
            { filename: `${name}.ifc`, mime: 'application/x-step', data },
            solids.length,
            triangles,
        );
    }

    if (format.id === 'step') {
        const data = exportStep(solids, { name, timestamp: options.timestamp });

        return single(
            { filename: `${name}.step`, mime: 'application/step', data },
            solids.length,
            triangles,
        );
    }

    if (format.id === 'gltf') {
        const data = exportGltf(solids, { name, upAxis: options.upAxis });

        return single(
            { filename: `${name}.gltf`, mime: 'model/gltf+json', data },
            solids.length,
            triangles,
        );
    }

    if (format.id === 'collada') {
        const data = exportCollada(solids, {
            name,
            timestamp: options.timestamp,
        });

        return single(
            { filename: `${name}.dae`, mime: 'model/vnd.collada+xml', data },
            solids.length,
            triangles,
        );
    }

    if (format.id === 'ply') {
        const data = exportPly(solids);

        return single(
            { filename: `${name}.ply`, mime: 'application/octet-stream', data },
            solids.length,
            triangles,
        );
    }

    if (format.id === 'obj') {
        const { obj, mtl } = exportObj(solids, name);

        return {
            files: [
                { filename: `${name}.obj`, mime: 'text/plain', data: obj },
                { filename: `${name}.mtl`, mime: 'text/plain', data: mtl },
            ],
            solids: solids.length,
            triangles,
            bytes: obj.length + mtl.length,
        };
    }

    if (format.id === 'stl-ascii') {
        const data = exportAsciiStl(solids, { name });

        return single(
            { filename: `${name}.stl`, mime: 'model/stl', data },
            solids.length,
            triangles,
        );
    }

    const data = exportBinaryStl(solids, { name });

    return single(
        { filename: `${name}.stl`, mime: 'model/stl', data },
        solids.length,
        triangles,
    );
}

function single(
    file: ExportFile,
    solids: number,
    triangles: number,
): ExportResult {
    return {
        files: [file],
        solids,
        triangles,
        bytes:
            typeof file.data === 'string'
                ? file.data.length
                : file.data.byteLength,
    };
}

/** Overall size of what will be written, for the dialog readout. */
export function describeExtents(options: ExportOptions): string | null {
    const bounds = boundsOfSolids(solidsForExport(options));

    if (!bounds) {
        return null;
    }

    const span = (from: number, to: number) =>
        Math.round(to - from).toLocaleString('en-CA');

    return `${span(bounds.min.x, bounds.max.x)} × ${span(bounds.min.y, bounds.max.y)} × ${span(
        bounds.min.z,
        bounds.max.z,
    )} mm`;
}

export function downloadExport(result: ExportResult): void {
    result.files.forEach((file) => {
        const blob = new Blob([file.data as BlobPart], { type: file.mime });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = url;
        link.download = file.filename;
        link.click();

        URL.revokeObjectURL(url);
    });
}

function sanitise(value: string): string {
    return (
        value
            .trim()
            .replace(/[^A-Za-z0-9._-]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .toLowerCase() || 'model'
    );
}
