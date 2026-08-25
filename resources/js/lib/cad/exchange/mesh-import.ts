import type { Point } from '@/lib/cad/types';

/**
 * Ceiling on imported geometry. Meshes live inside the project document, so a
 * scan with a million triangles would make the model unusable to load and
 * save; better to refuse it with an explanation.
 */
export const MAX_TRIANGLES = 20_000;

export type ImportedMesh = {
    name: string;
    /** Flat triangle list, nine numbers each, in millimetres. */
    vertices: number[];
    /** Convex hull of the mesh in plan. */
    footprint: Point[];
    size: { x: number; y: number; z: number };
    triangleCount: number;
};

export class MeshImportError extends Error {}

export function parseMesh(name: string, data: ArrayBuffer): ImportedMesh {
    const lower = name.toLowerCase();

    if (lower.endsWith('.obj')) {
        return parseObj(name, new TextDecoder().decode(data));
    }

    return parseStl(name, data);
}

/* -------------------------------------------------------------------- STL */

export function parseStl(name: string, data: ArrayBuffer): ImportedMesh {
    return isBinaryStl(data)
        ? finalise(name, parseBinaryStl(data))
        : finalise(name, parseAsciiStl(new TextDecoder().decode(data)));
}

/**
 * An STL is binary when its triangle count exactly accounts for the file
 * length. Sniffing for the word "solid" is unreliable — plenty of binary
 * writers put it in the 80 byte header.
 */
export function isBinaryStl(data: ArrayBuffer): boolean {
    if (data.byteLength < 84) {
        return false;
    }

    const count = new DataView(data).getUint32(80, true);

    return data.byteLength === 84 + count * 50;
}

function parseBinaryStl(data: ArrayBuffer): number[] {
    const view = new DataView(data);
    const count = view.getUint32(80, true);

    if (count > MAX_TRIANGLES) {
        throw new MeshImportError(
            `That STL has ${count.toLocaleString('en-CA')} triangles. The limit is ${MAX_TRIANGLES.toLocaleString('en-CA')} — decimate it first.`,
        );
    }

    const vertices: number[] = [];
    let offset = 84;

    for (let index = 0; index < count; index++) {
        // Skip the stored normal; it is recomputed from the winding on export.
        offset += 12;

        for (let corner = 0; corner < 3; corner++) {
            vertices.push(
                view.getFloat32(offset, true),
                view.getFloat32(offset + 4, true),
                view.getFloat32(offset + 8, true),
            );
            offset += 12;
        }

        offset += 2;
    }

    return vertices;
}

function parseAsciiStl(source: string): number[] {
    const vertices: number[] = [];
    const pattern =
        /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g;
    let match = pattern.exec(source);

    while (match !== null) {
        vertices.push(
            Number.parseFloat(match[1]),
            Number.parseFloat(match[2]),
            Number.parseFloat(match[3]),
        );

        if (vertices.length > MAX_TRIANGLES * 9) {
            throw new MeshImportError(
                `That STL exceeds the ${MAX_TRIANGLES.toLocaleString('en-CA')} triangle limit — decimate it first.`,
            );
        }

        match = pattern.exec(source);
    }

    return vertices;
}

/* -------------------------------------------------------------------- OBJ */

export function parseObj(name: string, source: string): ImportedMesh {
    const positions: number[] = [];
    const vertices: number[] = [];

    source.split(/\r\n|\r|\n/).forEach((raw) => {
        const line = raw.trim();

        if (line.startsWith('v ')) {
            const parts = line.slice(2).trim().split(/\s+/);
            positions.push(
                Number.parseFloat(parts[0]),
                Number.parseFloat(parts[1]),
                Number.parseFloat(parts[2]),
            );

            return;
        }

        if (!line.startsWith('f ')) {
            return;
        }

        const corners = line
            .slice(2)
            .trim()
            .split(/\s+/)
            .map((token) => {
                const index = Number.parseInt(token.split('/')[0], 10);

                // OBJ indices are 1 based, and negative means relative to the end.
                return index < 0 ? positions.length / 3 + index : index - 1;
            })
            .filter((index) => index >= 0 && index * 3 + 2 < positions.length);

        // Fan triangulate, which is correct for the convex faces OBJ tends to hold.
        for (let corner = 1; corner + 1 < corners.length; corner++) {
            [corners[0], corners[corner], corners[corner + 1]].forEach(
                (index) => {
                    vertices.push(
                        positions[index * 3],
                        positions[index * 3 + 1],
                        positions[index * 3 + 2],
                    );
                },
            );
        }

        if (vertices.length > MAX_TRIANGLES * 9) {
            throw new MeshImportError(
                `That OBJ exceeds the ${MAX_TRIANGLES.toLocaleString('en-CA')} triangle limit — decimate it first.`,
            );
        }
    });

    return finalise(name, vertices);
}

/* ---------------------------------------------------------------- shared */

/**
 * Centre the mesh on its footprint and sit it on the level, then work out the
 * plan outline and overall size.
 */
function finalise(name: string, vertices: number[]): ImportedMesh {
    if (vertices.length < 9) {
        throw new MeshImportError('No triangles found in that file.');
    }

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    for (let index = 0; index < vertices.length; index += 3) {
        minX = Math.min(minX, vertices[index]);
        maxX = Math.max(maxX, vertices[index]);
        minY = Math.min(minY, vertices[index + 1]);
        maxY = Math.max(maxY, vertices[index + 1]);
        minZ = Math.min(minZ, vertices[index + 2]);
        maxZ = Math.max(maxZ, vertices[index + 2]);
    }

    const shiftX = (minX + maxX) / 2;
    const shiftY = (minY + maxY) / 2;
    const plan: Point[] = [];

    for (let index = 0; index < vertices.length; index += 3) {
        vertices[index] = round(vertices[index] - shiftX);
        vertices[index + 1] = round(vertices[index + 1] - shiftY);
        vertices[index + 2] = round(vertices[index + 2] - minZ);

        plan.push({ x: vertices[index], y: vertices[index + 1] });
    }

    return {
        name: name.replace(/\.[^.]+$/, ''),
        vertices,
        footprint: convexHull(plan),
        size: {
            x: round(maxX - minX),
            y: round(maxY - minY),
            z: round(maxZ - minZ),
        },
        triangleCount: vertices.length / 9,
    };
}

function round(value: number): number {
    return Math.round(value * 10) / 10;
}

/**
 * Andrew's monotone chain hull, used to reduce thousands of projected
 * triangle corners to the outline shown in plan.
 */
export function convexHull(points: Point[]): Point[] {
    if (points.length < 3) {
        return points;
    }

    const sorted = [...points].sort((a, b) =>
        a.x === b.x ? a.y - b.y : a.x - b.x,
    );
    const cross = (o: Point, a: Point, b: Point) =>
        (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

    const build = (input: Point[]): Point[] => {
        const chain: Point[] = [];

        input.forEach((point) => {
            while (
                chain.length >= 2 &&
                cross(
                    chain[chain.length - 2],
                    chain[chain.length - 1],
                    point,
                ) <= 0
            ) {
                chain.pop();
            }

            chain.push(point);
        });

        chain.pop();

        return chain;
    };

    const hull = [...build(sorted), ...build([...sorted].reverse())];

    return hull.length >= 3 ? hull : points.slice(0, 3);
}
