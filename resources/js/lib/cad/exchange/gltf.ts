/**
 * glTF 2.0, which is what the web opens.
 *
 * The format every browser viewer, every phone AR preview and every model
 * host reads without a plugin. Written as a single `.gltf` with its buffer
 * base64 inside it rather than as a `.glb` plus a sidecar, because one file
 * is what someone emails a client.
 *
 * One mesh per solid category rather than per solid, so a house arrives as a
 * handful of named parts — Walls, Floors, Roof — instead of nine hundred
 * nodes nobody can select.
 */

import { solidTriangles } from '@/lib/cad/solids';
import type { Solid } from '@/lib/cad/solids';
import { MODEL_MATERIALS } from '@/lib/cad/theme';

type Part = {
    category: string;
    positions: number[];
    indices: number[];
};

export type GltfOptions = {
    name?: string;
    /** glTF is Y-up by convention; the model is Z-up. */
    upAxis?: 'y' | 'z';
};

export function exportGltf(solids: Solid[], options: GltfOptions = {}): string {
    const yUp = (options.upAxis ?? 'y') === 'y';
    const parts = new Map<string, Part>();

    solids.forEach((solid) => {
        const part = parts.get(solid.category) ?? {
            category: solid.category,
            positions: [],
            indices: [],
        };

        solidTriangles(solid).forEach((triangle) => {
            const base = part.positions.length / 3;

            triangle.forEach((vertex) => {
                part.positions.push(
                    vertex.x,
                    yUp ? vertex.z : vertex.y,
                    yUp ? -vertex.y : vertex.z,
                );
            });

            part.indices.push(base, base + 1, base + 2);
        });

        parts.set(solid.category, part);
    });

    const drawn = [...parts.values()].filter(
        (part) => part.indices.length > 0,
    );

    const bytes: number[] = [];
    const bufferViews: object[] = [];
    const accessors: object[] = [];
    const meshes: object[] = [];
    const nodes: object[] = [];
    const materials: object[] = [];

    /** Pad to four bytes, which glTF requires of every view. */
    const align = () => {
        while (bytes.length % 4 !== 0) {
            bytes.push(0);
        }
    };

    drawn.forEach((part, index) => {
        align();
        const positionOffset = bytes.length;
        const positionBuffer = new Uint8Array(
            new Float32Array(part.positions).buffer,
        );
        bytes.push(...positionBuffer);

        align();
        const indexOffset = bytes.length;
        const indexBuffer = new Uint8Array(
            new Uint32Array(part.indices).buffer,
        );
        bytes.push(...indexBuffer);

        // ARRAY_BUFFER and ELEMENT_ARRAY_BUFFER.
        bufferViews.push({
            buffer: 0,
            byteOffset: positionOffset,
            byteLength: positionBuffer.length,
            target: 34_962,
        });
        bufferViews.push({
            buffer: 0,
            byteOffset: indexOffset,
            byteLength: indexBuffer.length,
            target: 34_963,
        });

        // A POSITION accessor must carry its own bounds; viewers frame the
        // model from them without reading the buffer.
        accessors.push({
            bufferView: index * 2,
            componentType: 5126,
            count: part.positions.length / 3,
            type: 'VEC3',
            min: extreme(part.positions, Math.min),
            max: extreme(part.positions, Math.max),
        });
        accessors.push({
            bufferView: index * 2 + 1,
            componentType: 5125,
            count: part.indices.length,
            type: 'SCALAR',
        });

        materials.push({
            name: part.category,
            pbrMetallicRoughness: {
                baseColorFactor: colourOf(part.category),
                metallicFactor: 0,
                roughnessFactor: 0.85,
            },
            doubleSided: true,
        });

        meshes.push({
            name: part.category,
            primitives: [
                {
                    attributes: { POSITION: index * 2 },
                    indices: index * 2 + 1,
                    material: index,
                    mode: 4,
                },
            ],
        });

        nodes.push({ name: part.category, mesh: index });
    });

    const document = {
        asset: { version: '2.0', generator: 'Vanhaven' },
        scene: 0,
        scenes: [
            {
                name: options.name ?? 'model',
                nodes: nodes.map((_, index) => index),
            },
        ],
        nodes,
        meshes,
        materials,
        accessors,
        bufferViews,
        buffers: [
            {
                byteLength: bytes.length,
                uri: `data:application/octet-stream;base64,${base64(bytes)}`,
            },
        ],
    };

    return JSON.stringify(document, null, 2);
}

function extreme(
    positions: number[],
    pick: (...values: number[]) => number,
): [number, number, number] {
    const axis = (offset: number) => {
        let found = positions[offset] ?? 0;

        for (let index = offset; index < positions.length; index += 3) {
            found = pick(found, positions[index]);
        }

        return found;
    };

    return [axis(0), axis(1), axis(2)];
}

/** Base colour as glTF wants it: linear-ish RGBA, zero to one. */
function colourOf(category: string): [number, number, number, number] {
    const hex = MODEL_MATERIALS[category as keyof typeof MODEL_MATERIALS];

    if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) {
        return [0.7, 0.7, 0.7, 1];
    }

    const channel = (at: number) =>
        Math.round((parseInt(hex.slice(at, at + 2), 16) / 255) * 1000) / 1000;

    return [channel(1), channel(3), channel(5), 1];
}

const BASE64 =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Base64 without the platform's help.
 *
 * `btoa` is a browser function and `Buffer` is a Node one, and this file is
 * built once and runs in both — so it is spelled out rather than branched on.
 */
function base64(bytes: number[]): string {
    let out = '';

    for (let index = 0; index < bytes.length; index += 3) {
        const first = bytes[index];
        const second = bytes[index + 1];
        const third = bytes[index + 2];

        out += BASE64[first >> 2];
        out += BASE64[((first & 3) << 4) | ((second ?? 0) >> 4)];
        out +=
            second === undefined
                ? '='
                : BASE64[((second & 15) << 2) | ((third ?? 0) >> 6)];
        out += third === undefined ? '=' : BASE64[third & 63];
    }

    return out;
}
