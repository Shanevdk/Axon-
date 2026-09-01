/**
 * COLLADA, which is how a model gets into SketchUp.
 *
 * XML, verbose, and still the surest way into the older end of the toolchain
 * — SketchUp, 3ds Max, anything that predates glTF. One geometry per
 * category, the same grouping the glTF export uses, so a model looks the
 * same however it was carried.
 */

import { solidTriangles } from '@/lib/cad/solids';
import type { Solid } from '@/lib/cad/solids';
import { MODEL_MATERIALS } from '@/lib/cad/theme';

export type ColladaOptions = {
    name?: string;
    timestamp?: string;
};

export function exportCollada(
    solids: Solid[],
    options: ColladaOptions = {},
): string {
    const stamp = options.timestamp ?? '1970-01-01T00:00:00Z';
    const parts = new Map<string, number[]>();

    solids.forEach((solid) => {
        const held = parts.get(solid.category) ?? [];

        solidTriangles(solid).forEach((triangle) => {
            triangle.forEach((vertex) => {
                held.push(vertex.x, vertex.y, vertex.z);
            });
        });

        parts.set(solid.category, held);
    });

    const drawn = [...parts.entries()].filter(
        ([, positions]) => positions.length > 0,
    );

    const effects = drawn
        .map(([category]) => {
            const [red, green, blue] = colourOf(category);

            return `      <effect id="${category}-effect">
        <profile_COMMON>
          <technique sid="common">
            <lambert>
              <diffuse><color>${red} ${green} ${blue} 1</color></diffuse>
            </lambert>
          </technique>
        </profile_COMMON>
      </effect>`;
        })
        .join('\n');

    const materials = drawn
        .map(
            ([category]) =>
                `      <material id="${category}-material" name="${category}"><instance_effect url="#${category}-effect"/></material>`,
        )
        .join('\n');

    const geometries = drawn
        .map(([category, positions]) => {
            const count = positions.length / 3;
            const indices = Array.from({ length: count }, (_, at) => at);

            return `      <geometry id="${category}-geometry" name="${category}">
        <mesh>
          <source id="${category}-positions">
            <float_array id="${category}-positions-array" count="${positions.length}">${positions
                .map(round)
                .join(' ')}</float_array>
            <technique_common>
              <accessor source="#${category}-positions-array" count="${count}" stride="3">
                <param name="X" type="float"/>
                <param name="Y" type="float"/>
                <param name="Z" type="float"/>
              </accessor>
            </technique_common>
          </source>
          <vertices id="${category}-vertices">
            <input semantic="POSITION" source="#${category}-positions"/>
          </vertices>
          <triangles count="${count / 3}" material="${category}-material">
            <input semantic="VERTEX" source="#${category}-vertices" offset="0"/>
            <p>${indices.join(' ')}</p>
          </triangles>
        </mesh>
      </geometry>`;
        })
        .join('\n');

    const nodes = drawn
        .map(
            ([category]) => `        <node id="${category}-node" name="${category}" type="NODE">
          <instance_geometry url="#${category}-geometry">
            <bind_material>
              <technique_common>
                <instance_material symbol="${category}-material" target="#${category}-material"/>
              </technique_common>
            </bind_material>
          </instance_geometry>
        </node>`,
        )
        .join('\n');

    return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset>
    <contributor><authoring_tool>Vanhaven</authoring_tool></contributor>
    <created>${stamp}</created>
    <modified>${stamp}</modified>
    <unit meter="0.001" name="millimeter"/>
    <up_axis>Z_UP</up_axis>
  </asset>
  <library_effects>
${effects}
  </library_effects>
  <library_materials>
${materials}
  </library_materials>
  <library_geometries>
${geometries}
  </library_geometries>
  <library_visual_scenes>
    <visual_scene id="scene" name="${escapeXml(options.name ?? 'model')}">
${nodes}
    </visual_scene>
  </library_visual_scenes>
  <scene><instance_visual_scene url="#scene"/></scene>
</COLLADA>
`;
}

function colourOf(category: string): [number, number, number] {
    const hex = MODEL_MATERIALS[category as keyof typeof MODEL_MATERIALS];

    if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) {
        return [0.7, 0.7, 0.7];
    }

    const channel = (at: number) =>
        Math.round((parseInt(hex.slice(at, at + 2), 16) / 255) * 1000) / 1000;

    return [channel(1), channel(3), channel(5)];
}

function round(value: number): string {
    return String(Math.round(value * 1000) / 1000);
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
