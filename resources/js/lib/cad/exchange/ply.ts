/**
 * PLY, the Stanford polygon format.
 *
 * A header saying what the columns are, then the numbers. Nothing else can
 * be read by as many things with as little ceremony — meshlab, CloudCompare,
 * Blender, half the scanning tools in the world — and unlike STL it carries
 * colour, so a model arrives with its materials rather than in grey.
 */

import type { Solid, Vec3 } from '@/lib/cad/solids';
import { solidTriangles } from '@/lib/cad/solids';
import { MODEL_MATERIALS } from '@/lib/cad/theme';

/** The colour a category is drawn in, as bytes. */
function colourOf(category: string): [number, number, number] {
    const hex = MODEL_MATERIALS[category as keyof typeof MODEL_MATERIALS];

    if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) {
        return [180, 180, 180];
    }

    return [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
    ];
}

export function exportPly(solids: Solid[]): string {
    const vertices: string[] = [];
    const faces: string[] = [];
    let next = 0;

    solids.forEach((solid) => {
        const [red, green, blue] = colourOf(solid.category);

        solidTriangles(solid).forEach((triangle) => {
            triangle.forEach((vertex: Vec3) => {
                vertices.push(
                    `${round(vertex.x)} ${round(vertex.y)} ${round(vertex.z)} ${red} ${green} ${blue}`,
                );
            });

            faces.push(`3 ${next} ${next + 1} ${next + 2}`);
            next += 3;
        });
    });

    return [
        'ply',
        'format ascii 1.0',
        'comment Vanhaven model, millimetres',
        `element vertex ${vertices.length}`,
        'property float x',
        'property float y',
        'property float z',
        'property uchar red',
        'property uchar green',
        'property uchar blue',
        `element face ${faces.length}`,
        'property list uchar int vertex_index',
        'end_header',
        ...vertices,
        ...faces,
        '',
    ].join('\n');
}

function round(value: number): string {
    return String(Math.round(value * 1000) / 1000);
}
