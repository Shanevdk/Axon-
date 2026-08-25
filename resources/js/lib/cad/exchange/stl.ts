import { faceNormal, solidTriangles } from '@/lib/cad/solids';
import type { Solid, Vec3 } from '@/lib/cad/solids';

/**
 * STL carries no units, so most downstream tools assume millimetres. That is
 * already the document's internal unit, which makes this a straight copy.
 */
export type StlOptions = {
    /** Name written into the ASCII header. */
    name?: string;
};

function triangleNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
    return faceNormal([a, b, c]);
}

export function exportAsciiStl(
    solids: Solid[],
    options: StlOptions = {},
): string {
    const name = (options.name ?? 'model').replace(/\s+/g, '_');
    const lines: string[] = [`solid ${name}`];

    solids.forEach((solid) => {
        solidTriangles(solid).forEach(([a, b, c]) => {
            const normal = triangleNormal(a, b, c);

            lines.push(
                `  facet normal ${number(normal.x)} ${number(normal.y)} ${number(normal.z)}`,
                '    outer loop',
                `      vertex ${number(a.x)} ${number(a.y)} ${number(a.z)}`,
                `      vertex ${number(b.x)} ${number(b.y)} ${number(b.z)}`,
                `      vertex ${number(c.x)} ${number(c.y)} ${number(c.z)}`,
                '    endloop',
                '  endfacet',
            );
        });
    });

    lines.push(`endsolid ${name}`, '');

    return lines.join('\n');
}

export function exportBinaryStl(
    solids: Solid[],
    options: StlOptions = {},
): ArrayBuffer {
    const triangles = solids.flatMap(solidTriangles);
    const buffer = new ArrayBuffer(84 + triangles.length * 50);
    const view = new DataView(buffer);
    const header = `Axon - ${options.name ?? 'model'}`;

    // 80 byte header, truncated or zero padded.
    for (let index = 0; index < 80; index++) {
        view.setUint8(
            index,
            index < header.length ? header.charCodeAt(index) & 0x7f : 0,
        );
    }

    view.setUint32(80, triangles.length, true);

    let offset = 84;

    triangles.forEach(([a, b, c]) => {
        const normal = triangleNormal(a, b, c);

        [normal, a, b, c].forEach((vertex) => {
            view.setFloat32(offset, vertex.x, true);
            view.setFloat32(offset + 4, vertex.y, true);
            view.setFloat32(offset + 8, vertex.z, true);
            offset += 12;
        });

        // Attribute byte count, unused.
        view.setUint16(offset, 0, true);
        offset += 2;
    });

    return buffer;
}

export function countStlTriangles(solids: Solid[]): number {
    return solids.reduce(
        (total, solid) => total + solidTriangles(solid).length,
        0,
    );
}

function number(value: number): string {
    return Number.isFinite(value) ? value.toFixed(4) : '0.0000';
}
