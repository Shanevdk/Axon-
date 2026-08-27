import type { Solid, SolidCategory } from '@/lib/cad/solids';
import { MODEL_MATERIALS } from '@/lib/cad/theme';

const MATERIAL_NAMES: Record<SolidCategory, string> = {
    wall: 'VH_Wall',
    column: 'VH_Column',
    floor: 'VH_Floor',
    door: 'VH_Door',
    window: 'VH_Glazing',
    mesh: 'VH_Imported',
    roof: 'VH_Roof',
    ceiling: 'VH_Ceiling',
    stair: 'VH_Stair',
    beam: 'VH_Framing',
    railing: 'VH_Railing',
    foundation: 'VH_Foundation',
    duct: 'VH_Duct',
    pipe: 'VH_Pipe',
    cableTray: 'VH_CableTray',
    fixture: 'VH_Component',
    planting: 'VH_Planting',
    site: 'VH_Site',
};

const MATERIAL_COLOURS: Record<SolidCategory, string> = {
    wall: MODEL_MATERIALS.wallExterior,
    column: MODEL_MATERIALS.column,
    floor: MODEL_MATERIALS.floor,
    door: MODEL_MATERIALS.doorLeaf,
    window: MODEL_MATERIALS.glass,
    mesh: MODEL_MATERIALS.mesh,
    roof: MODEL_MATERIALS.roofSlab,
    ceiling: MODEL_MATERIALS.wallInterior,
    stair: MODEL_MATERIALS.column,
    beam: MODEL_MATERIALS.frame,
    railing: MODEL_MATERIALS.railing,
    foundation: MODEL_MATERIALS.foundation,
    duct: MODEL_MATERIALS.duct,
    pipe: MODEL_MATERIALS.pipe,
    cableTray: MODEL_MATERIALS.cableTray,
    fixture: MODEL_MATERIALS.fixture,
    planting: MODEL_MATERIALS.planting,
    site: MODEL_MATERIALS.site,
};

export type ObjResult = {
    obj: string;
    mtl: string;
};

/**
 * Wavefront OBJ, one object per solid and one material per element category.
 *
 * OBJ takes n-gons directly, so faces go out whole rather than triangulated —
 * a wall reads as six quads instead of twelve triangles.
 */
export function exportObj(solids: Solid[], name = 'model'): ObjResult {
    const lines: string[] = [
        `# Axon`,
        `# ${solids.length} solids, millimetres`,
        `mtllib ${name}.mtl`,
        '',
    ];

    const usedCategories = new Set<SolidCategory>();
    let vertexCount = 0;

    solids.forEach((solid) => {
        usedCategories.add(solid.category);

        lines.push(`o ${sanitise(solid.name)}_${sanitise(solid.id)}`);
        lines.push(`usemtl ${MATERIAL_NAMES[solid.category]}`);

        const base = vertexCount;
        const faceIndices: number[][] = [];

        solid.faces.forEach((face) => {
            const indices: number[] = [];

            face.forEach((vertex) => {
                vertexCount += 1;
                indices.push(vertexCount);
                lines.push(
                    `v ${real(vertex.x)} ${real(vertex.y)} ${real(vertex.z)}`,
                );
            });

            faceIndices.push(indices);
        });

        faceIndices.forEach((indices) => {
            lines.push(`f ${indices.join(' ')}`);
        });

        void base;
        lines.push('');
    });

    return { obj: lines.join('\n'), mtl: buildMtl(usedCategories) };
}

function buildMtl(categories: Set<SolidCategory>): string {
    const lines = ['# Axon', ''];

    categories.forEach((category) => {
        const [red, green, blue] = toLinear(MATERIAL_COLOURS[category]);

        lines.push(
            `newmtl ${MATERIAL_NAMES[category]}`,
            `Kd ${real(red)} ${real(green)} ${real(blue)}`,
            'Ka 0.100000 0.100000 0.100000',
            'Ks 0.050000 0.050000 0.050000',
            `d ${category === 'window' ? '0.550000' : '1.000000'}`,
            'illum 2',
            '',
        );
    });

    return lines.join('\n');
}

function toLinear(hex: string): [number, number, number] {
    const value = hex.replace('#', '');

    return [
        Number.parseInt(value.slice(0, 2), 16) / 255,
        Number.parseInt(value.slice(2, 4), 16) / 255,
        Number.parseInt(value.slice(4, 6), 16) / 255,
    ];
}

function sanitise(value: string): string {
    return value.replace(/[^A-Za-z0-9_-]+/g, '_');
}

function real(value: number): string {
    return value.toFixed(6);
}
