import { lerp, signedArea, triangulate } from '@/lib/cad/geometry';
import {
    buildWallGeometry,
    clampOpeningParameter,
    openingSize,
    wallsOnLevel,
} from '@/lib/cad/model';
import type { WallGeometry } from '@/lib/cad/model';
import type {
    BeamElement,
    CadDocument,
    CeilingElement,
    ColumnElement,
    FloorElement,
    MeshElement,
    OpeningElement,
    Point,
    RampElement,
    RoofElement,
    StairElement,
} from '@/lib/cad/types';

export type Vec3 = { x: number; y: number; z: number };

export type SolidCategory =
    | 'wall'
    | 'column'
    | 'floor'
    | 'door'
    | 'window'
    | 'roof'
    | 'ceiling'
    | 'stair'
    | 'beam'
    | 'mesh';

/**
 * A closed polyhedron. Every face is planar and wound counter-clockwise when
 * seen from outside the solid, which is what the solid exporters need to emit
 * valid STEP breps and correctly oriented STL normals.
 */
export type Solid = {
    id: string;
    name: string;
    category: SolidCategory;
    /** The model element this solid came from, for selection-scoped exports. */
    elementId: string;
    level: string;
    faces: Vec3[][];
    /** Lowest point of the solid, used to stack slabs when drawing. */
    base: number;
};

export type SolidScope = {
    /** Restrict to these level ids. Omit for every level. */
    levels?: string[];
    /** Restrict to these element ids. Omit for every element. */
    elementIds?: string[];
};

export function buildSolids(
    document: CadDocument,
    scope: SolidScope = {},
): Solid[] {
    const solids: Solid[] = [];
    const wanted = scope.elementIds ? new Set(scope.elementIds) : null;
    const levels = scope.levels
        ? document.levels.filter((level) => scope.levels?.includes(level.id))
        : document.levels;

    levels.forEach((level) => {
        const geometry = buildWallGeometry(
            document,
            wallsOnLevel(document, level.id),
        );

        geometry.forEach((wall) => {
            if (wall.wall.phase === 'demolished') {
                return;
            }

            const openings = openingsFor(document, wall.wall.id);

            if (!wanted || wanted.has(wall.wall.id)) {
                solids.push(
                    ...(wall.type.function === 'curtain'
                        ? curtainSolids(wall, level.elevation)
                        : wallSolids(
                              document,
                              wall,
                              level.elevation,
                              openings,
                          )),
                );
            }

            openings.forEach((opening) => {
                if (wanted && !wanted.has(opening.id)) {
                    return;
                }

                const panel = openingSolid(
                    document,
                    wall,
                    level.elevation,
                    opening,
                );

                if (panel) {
                    solids.push(panel);
                }
            });
        });

        document.elements.forEach((element) => {
            if (
                element.level !== level.id ||
                (wanted && !wanted.has(element.id)) ||
                element.phase === 'demolished'
            ) {
                return;
            }

            if (element.kind === 'floor') {
                const slab = floorSolid(element, level.elevation);

                if (slab) {
                    solids.push(slab);
                }
            }

            if (element.kind === 'column') {
                solids.push(columnSolid(element, level.elevation));
            }

            if (element.kind === 'mesh') {
                const mesh = meshSolid(element, level.elevation);

                if (mesh) {
                    solids.push(mesh);
                }
            }

            if (element.kind === 'roof') {
                const roof = roofSolid(element, level.elevation);

                if (roof) {
                    solids.push(roof);
                }
            }

            if (element.kind === 'ceiling') {
                const ceiling = ceilingSolid(element, level.elevation);

                if (ceiling) {
                    solids.push(ceiling);
                }
            }

            if (element.kind === 'stair') {
                solids.push(...stairSolids(element, level.elevation));
            }

            if (element.kind === 'beam') {
                const beam = beamSolid(element, level.elevation);

                if (beam) {
                    solids.push(beam);
                }
            }

            if (element.kind === 'ramp') {
                solids.push(...rampSolids(element, level.elevation));
            }
        });
    });

    return solids;
}

/* ------------------------------------------------------------- primitives */

/** Reverse a footprint if needed so it winds counter-clockwise in plan. */
export function ensureCounterClockwise(base: Point[]): Point[] {
    return signedArea(base) < 0 ? [...base].reverse() : base;
}

/**
 * Extrude a footprint between two elevations into a closed prism.
 *
 * The cap and side windings follow from the footprint being counter-clockwise:
 * the top cap keeps that order, the bottom cap reverses it, and each side runs
 * along the footprint edge then up, which puts every normal outward.
 */
export function prism(
    footprint: Point[],
    bottom: number,
    top: number,
): Vec3[][] {
    const base = ensureCounterClockwise(footprint);

    if (base.length < 3 || top - bottom < 1e-6) {
        return [];
    }

    const at = (p: Point, z: number): Vec3 => ({ x: p.x, y: p.y, z });

    const faces: Vec3[][] = [
        base.map((p) => at(p, top)),
        [...base].reverse().map((p) => at(p, bottom)),
    ];

    for (let index = 0; index < base.length; index++) {
        const current = base[index];
        const next = base[(index + 1) % base.length];

        faces.push([
            at(current, bottom),
            at(next, bottom),
            at(next, top),
            at(current, top),
        ]);
    }

    return faces;
}

export function boxAround(
    centre: Point,
    size: number,
    rotation: number,
): Point[] {
    const half = size / 2;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    return [
        { x: -half, y: -half },
        { x: half, y: -half },
        { x: half, y: half },
        { x: -half, y: half },
    ].map((corner) => ({
        x: centre.x + corner.x * cos - corner.y * sin,
        y: centre.y + corner.x * sin + corner.y * cos,
    }));
}

/* ------------------------------------------------------------------ walls */

function openingsFor(document: CadDocument, wallId: string): OpeningElement[] {
    return document.elements
        .filter(
            (element): element is OpeningElement =>
                (element.kind === 'door' || element.kind === 'window') &&
                element.host === wallId,
        )
        .sort((a, b) => a.t - b.t);
}

type Span = { from: number; to: number };

/** The runs of solid wall left between the openings. */
export function solidSpans(
    document: CadDocument,
    wall: WallGeometry,
    openings: OpeningElement[],
): Span[] {
    const voids = openings
        .map((opening) => {
            const { width } = openingSize(document, opening);
            const t = clampOpeningParameter(width, wall.length, opening.t);
            const half = width / 2 / wall.length;

            return { from: t - half, to: t + half };
        })
        .sort((a, b) => a.from - b.from);

    const spans: Span[] = [];
    let cursor = 0;

    voids.forEach((gap) => {
        if (gap.from > cursor) {
            spans.push({ from: cursor, to: gap.from });
        }

        cursor = Math.max(cursor, gap.to);
    });

    if (cursor < 1) {
        spans.push({ from: cursor, to: 1 });
    }

    return spans.filter((span) => span.to - span.from > 1e-4);
}

/** Footprint of the slice of wall between two parameters along its length. */
export function wallSliceFootprint(wall: WallGeometry, span: Span): Point[] {
    const [aLeft, bLeft, bRight, aRight] = wall.polygon;

    return [
        lerp(aLeft, bLeft, span.from),
        lerp(aLeft, bLeft, span.to),
        lerp(aRight, bRight, span.to),
        lerp(aRight, bRight, span.from),
    ];
}

function wallSolids(
    document: CadDocument,
    wall: WallGeometry,
    elevation: number,
    openings: OpeningElement[],
): Solid[] {
    const bottom = elevation + wall.wall.baseOffset;
    const top = bottom + wall.wall.height;
    const solids: Solid[] = [];

    const push = (span: Span, from: number, to: number, suffix: string) => {
        const faces = prism(wallSliceFootprint(wall, span), from, to);

        if (faces.length > 0) {
            solids.push({
                id: `${wall.wall.id}-${suffix}`,
                name: `${wall.type.name} (${suffix})`,
                category: 'wall',
                elementId: wall.wall.id,
                level: wall.wall.level,
                faces,
                base: from,
            });
        }
    };

    solidSpans(document, wall, openings).forEach((span, index) => {
        push(span, bottom, top, `run-${index + 1}`);
    });

    // Lintels above and sills below each opening keep the wall continuous.
    openings.forEach((opening, index) => {
        const { width, height, sillHeight } = openingSize(document, opening);
        const t = clampOpeningParameter(width, wall.length, opening.t);
        const half = width / 2 / wall.length;
        const span = { from: t - half, to: t + half };
        const head = bottom + sillHeight + height;

        if (head < top) {
            push(span, head, top, `lintel-${index + 1}`);
        }

        if (sillHeight > 0) {
            push(span, bottom, bottom + sillHeight, `sill-${index + 1}`);
        }
    });

    return solids;
}

function openingSolid(
    document: CadDocument,
    wall: WallGeometry,
    elevation: number,
    opening: OpeningElement,
): Solid | null {
    const { width, height, sillHeight } = openingSize(document, opening);
    const t = clampOpeningParameter(width, wall.length, opening.t);
    const half = width / 2 / wall.length;
    // Inset so the reveal of the opening stays visible in the model.
    const inset = Math.min(50 / wall.length, half * 0.2);
    const footprint = wallSliceFootprint(wall, {
        from: t - half + inset,
        to: t + half - inset,
    });
    const thickness = opening.kind === 'door' ? 45 : 24;
    const panel = insetAcross(footprint, wall.thickness, thickness);

    const bottom = elevation + sillHeight + (opening.kind === 'door' ? 0 : 60);
    const top = elevation + sillHeight + height - 60;

    if (top <= bottom) {
        return null;
    }

    const faces = prism(panel, bottom, top);

    if (faces.length === 0) {
        return null;
    }

    return {
        id: `${opening.id}-panel`,
        name: opening.kind === 'door' ? 'Door leaf' : 'Glazing',
        category: opening.kind,
        elementId: opening.id,
        level: opening.level,
        faces,
        base: bottom,
    };
}

/**
 * Narrow a wall slice footprint down to a centred panel of the given
 * thickness, so a door leaf sits inside the reveal rather than filling it.
 */
function insetAcross(
    footprint: Point[],
    wallThickness: number,
    panelThickness: number,
): Point[] {
    const [startLeft, endLeft, endRight, startRight] = footprint;
    const factor = Math.min(panelThickness / Math.max(wallThickness, 1), 1) / 2;

    return [
        lerp(startLeft, startRight, 0.5 - factor),
        lerp(endLeft, endRight, 0.5 - factor),
        lerp(endLeft, endRight, 0.5 + factor),
        lerp(startLeft, startRight, 0.5 + factor),
    ];
}

/* ------------------------------------------------------- other categories */

function floorSolid(floor: FloorElement, elevation: number): Solid | null {
    const top = elevation + floor.offset;
    const faces = prism(floor.points, top - floor.thickness, top);

    if (faces.length === 0) {
        return null;
    }

    return {
        id: floor.id,
        name: `Floor ${floor.thickness}mm`,
        category: 'floor',
        elementId: floor.id,
        level: floor.level,
        faces,
        base: top - floor.thickness,
    };
}

function columnSolid(column: ColumnElement, elevation: number): Solid {
    return {
        id: column.id,
        name: `Column ${column.size}mm`,
        category: 'column',
        elementId: column.id,
        level: column.level,
        faces: prism(
            boxAround(column.p, column.size, column.rotation),
            elevation,
            elevation + column.height,
        ),
        base: elevation,
    };
}

/**
 * Imported meshes carry their own triangles. They are placed, rotated and
 * scaled here but not re-solidified — whatever was imported is what is drawn
 * and what is written back out.
 */
function meshSolid(mesh: MeshElement, elevation: number): Solid | null {
    if (mesh.vertices.length < 9) {
        return null;
    }

    const cos = Math.cos(mesh.rotation);
    const sin = Math.sin(mesh.rotation);
    const place = (x: number, y: number, z: number): Vec3 => {
        const sx = x * mesh.scale;
        const sy = y * mesh.scale;

        return {
            x: mesh.p.x + sx * cos - sy * sin,
            y: mesh.p.y + sx * sin + sy * cos,
            z: elevation + mesh.baseOffset + z * mesh.scale,
        };
    };

    const faces: Vec3[][] = [];

    for (let index = 0; index + 8 < mesh.vertices.length; index += 9) {
        faces.push([
            place(
                mesh.vertices[index],
                mesh.vertices[index + 1],
                mesh.vertices[index + 2],
            ),
            place(
                mesh.vertices[index + 3],
                mesh.vertices[index + 4],
                mesh.vertices[index + 5],
            ),
            place(
                mesh.vertices[index + 6],
                mesh.vertices[index + 7],
                mesh.vertices[index + 8],
            ),
        ]);
    }

    return {
        id: mesh.id,
        name: mesh.name,
        category: 'mesh',
        elementId: mesh.id,
        level: mesh.level,
        faces,
        base: elevation + mesh.baseOffset,
    };
}

/* ------------------------------------------------------------ tessellation */

export function faceNormal(face: Vec3[]): Vec3 {
    // Newell's method, which is stable for near-degenerate polygons.
    let x = 0;
    let y = 0;
    let z = 0;

    for (let index = 0; index < face.length; index++) {
        const current = face[index];
        const next = face[(index + 1) % face.length];

        x += (current.y - next.y) * (current.z + next.z);
        y += (current.z - next.z) * (current.x + next.x);
        z += (current.x - next.x) * (current.y + next.y);
    }

    const magnitude = Math.hypot(x, y, z);

    return magnitude < 1e-9
        ? { x: 0, y: 0, z: 0 }
        : { x: x / magnitude, y: y / magnitude, z: z / magnitude };
}

/**
 * Split a planar face into triangles, preserving its outward winding.
 *
 * The face is projected onto whichever axis-aligned plane it faces most
 * directly, with the two remaining axes ordered so counter-clockwise in the
 * projection stays counter-clockwise in space.
 */
export function triangulateFace(face: Vec3[]): [Vec3, Vec3, Vec3][] {
    if (face.length < 3) {
        return [];
    }

    if (face.length === 3) {
        return [[face[0], face[1], face[2]]];
    }

    const normal = faceNormal(face);
    const absolute = {
        x: Math.abs(normal.x),
        y: Math.abs(normal.y),
        z: Math.abs(normal.z),
    };
    let project: (v: Vec3) => Point;

    if (absolute.x >= absolute.y && absolute.x >= absolute.z) {
        project =
            normal.x >= 0
                ? (v) => ({ x: v.y, y: v.z })
                : (v) => ({ x: v.z, y: v.y });
    } else if (absolute.y >= absolute.z) {
        project =
            normal.y >= 0
                ? (v) => ({ x: v.z, y: v.x })
                : (v) => ({ x: v.x, y: v.z });
    } else {
        project =
            normal.z >= 0
                ? (v) => ({ x: v.x, y: v.y })
                : (v) => ({ x: v.y, y: v.x });
    }

    return triangulate(face.map(project)).map(
        ([a, b, c]) => [face[a], face[b], face[c]] as [Vec3, Vec3, Vec3],
    );
}

export function solidTriangles(solid: Solid): [Vec3, Vec3, Vec3][] {
    return solid.faces.flatMap(triangulateFace);
}

export type SolidBounds = { min: Vec3; max: Vec3 };

export function boundsOfSolids(solids: Solid[]): SolidBounds | null {
    const vertices = solids.flatMap((solid) => solid.faces.flat());

    if (vertices.length === 0) {
        return null;
    }

    return vertices.reduce<SolidBounds>(
        (bounds, vertex) => ({
            min: {
                x: Math.min(bounds.min.x, vertex.x),
                y: Math.min(bounds.min.y, vertex.y),
                z: Math.min(bounds.min.z, vertex.z),
            },
            max: {
                x: Math.max(bounds.max.x, vertex.x),
                y: Math.max(bounds.max.y, vertex.y),
                z: Math.max(bounds.max.z, vertex.z),
            },
        }),
        {
            min: { x: Infinity, y: Infinity, z: Infinity },
            max: { x: -Infinity, y: -Infinity, z: -Infinity },
        },
    );
}

/* -------------------------------------------------- roofs, stairs, framing */

/**
 * Push a footprint outward by the eave overhang, mitring at the corners the
 * same way wall joins do. Falls back to a bevelled corner when a mitre
 * degenerates, so a spiky sketch never produces a folded eave.
 */
export function expandFootprint(footprint: Point[], amount: number): Point[] {
    const base = ensureCounterClockwise(footprint);

    if (amount <= 0 || base.length < 3) {
        return base;
    }

    const expanded: Point[] = [];

    for (let index = 0; index < base.length; index++) {
        const previous = base[(index - 1 + base.length) % base.length];
        const current = base[index];
        const next = base[(index + 1) % base.length];

        const incoming = normalize2(subtract2(current, previous));
        const outgoing = normalize2(subtract2(next, current));
        // Outward is to the right of travel on a counter-clockwise loop.
        const inNormal = { x: incoming.y, y: -incoming.x };
        const outNormal = { x: outgoing.y, y: -outgoing.x };

        const corner = intersect2(
            {
                x: previous.x + inNormal.x * amount,
                y: previous.y + inNormal.y * amount,
            },
            incoming,
            {
                x: current.x + outNormal.x * amount,
                y: current.y + outNormal.y * amount,
            },
            outgoing,
        );

        if (
            !corner ||
            Math.hypot(corner.x - current.x, corner.y - current.y) > amount * 6
        ) {
            expanded.push({
                x: current.x + (inNormal.x + outNormal.x) * amount * 0.5,
                y: current.y + (inNormal.y + outNormal.y) * amount * 0.5,
            });
        } else {
            expanded.push(corner);
        }
    }

    return expanded;
}

function subtract2(a: Point, b: Point): Point {
    return { x: a.x - b.x, y: a.y - b.y };
}

function normalize2(a: Point): Point {
    const length = Math.hypot(a.x, a.y);

    return length < 1e-9
        ? { x: 0, y: 0 }
        : { x: a.x / length, y: a.y / length };
}

function intersect2(
    originA: Point,
    directionA: Point,
    originB: Point,
    directionB: Point,
): Point | null {
    const denominator =
        directionA.x * directionB.y - directionA.y * directionB.x;

    if (Math.abs(denominator) < 1e-7) {
        return null;
    }

    const t =
        ((originB.x - originA.x) * directionB.y -
            (originB.y - originA.y) * directionB.x) /
        denominator;

    return {
        x: originA.x + directionA.x * t,
        y: originA.y + directionA.y * t,
    };
}

function distance2(a: Point, b: Point): number {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * The ridge of a roof: for a quadrilateral footprint, a hip ridge inset along
 * the long axis; for anything else, a single peak at the centroid so the roof
 * reads as a pavilion.
 */
export function roofRidge(
    footprint: Point[],
    slope: number,
): { points: [Point, Point] | [Point]; height: number } {
    const base = ensureCounterClockwise(footprint);
    const rise = Math.tan((slope * Math.PI) / 180);

    if (base.length === 4) {
        const edgeA = Math.hypot(base[1].x - base[0].x, base[1].y - base[0].y);
        const edgeB = Math.hypot(base[2].x - base[1].x, base[2].y - base[1].y);
        const half = Math.min(edgeA, edgeB) / 2;

        const mid = (a: Point, b: Point): Point => ({
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
        });

        // Ridge runs between the midpoints of the two short edges, pulled in
        // by half the short span so the hips pitch at the same angle.
        const [endA, endB] =
            edgeA >= edgeB
                ? [mid(base[3], base[0]), mid(base[1], base[2])]
                : [mid(base[0], base[1]), mid(base[2], base[3])];

        const along = normalize2(subtract2(endB, endA));
        const ridgeA = {
            x: endA.x + along.x * half,
            y: endA.y + along.y * half,
        };
        const ridgeB = {
            x: endB.x - along.x * half,
            y: endB.y - along.y * half,
        };

        if (Math.hypot(ridgeB.x - ridgeA.x, ridgeB.y - ridgeA.y) > 1) {
            return { points: [ridgeA, ridgeB], height: half * rise };
        }
    }

    let cx = 0;
    let cy = 0;
    base.forEach((p) => {
        cx += p.x / base.length;
        cy += p.y / base.length;
    });

    const meanReach =
        base.reduce((total, p) => total + Math.hypot(p.x - cx, p.y - cy), 0) /
        base.length;

    return { points: [{ x: cx, y: cy }], height: meanReach * 0.55 * rise };
}

function roofSolid(roof: RoofElement, elevation: number): Solid | null {
    if (roof.points.length < 3) {
        return null;
    }

    const eave = expandFootprint(roof.points, roof.overhang);
    const plate = elevation + roof.baseOffset;
    const ridge = roofRidge(eave, roof.slope);
    const top = plate + ridge.height;

    const at = (p: Point, z: number): Vec3 => ({ x: p.x, y: p.y, z });
    const faces: Vec3[][] = [[...eave].reverse().map((p) => at(p, plate))];

    if (ridge.points.length === 1) {
        const peak = at(ridge.points[0], top);

        for (let index = 0; index < eave.length; index++) {
            faces.push([
                at(eave[index], plate),
                at(eave[(index + 1) % eave.length], plate),
                peak,
            ]);
        }
    } else {
        const [ridgeA, ridgeB] = ridge.points;

        for (let index = 0; index < eave.length; index++) {
            const current = eave[index];
            const next = eave[(index + 1) % eave.length];

            // Aim each eave edge at whichever ridge end is nearer, which
            // produces the two trapezoid slopes and two triangular hips.
            const nearCurrent =
                distance2(current, ridgeA) <= distance2(current, ridgeB)
                    ? ridgeA
                    : ridgeB;
            const nearNext =
                distance2(next, ridgeA) <= distance2(next, ridgeB)
                    ? ridgeA
                    : ridgeB;

            if (nearCurrent === nearNext) {
                faces.push([
                    at(current, plate),
                    at(next, plate),
                    at(nearCurrent, top),
                ]);
            } else {
                faces.push([
                    at(current, plate),
                    at(next, plate),
                    at(nearNext, top),
                    at(nearCurrent, top),
                ]);
            }
        }
    }

    return {
        id: roof.id,
        name: `Roof ${roof.slope}°`,
        category: 'roof',
        elementId: roof.id,
        level: roof.level,
        faces,
        base: plate,
    };
}

function ceilingSolid(
    ceiling: CeilingElement,
    elevation: number,
): Solid | null {
    const bottom = elevation + ceiling.heightOffset;
    const faces = prism(ceiling.points, bottom, bottom + 50);

    if (faces.length === 0) {
        return null;
    }

    return {
        id: ceiling.id,
        name: 'Ceiling',
        category: 'ceiling',
        elementId: ceiling.id,
        level: ceiling.level,
        faces,
        base: bottom,
    };
}

/** Maximum riser height, matching common residential code. */
export const MAX_RISER = 190;

export function stairSteps(stair: StairElement): {
    count: number;
    riser: number;
    going: number;
} {
    const run = distance2(stair.a, stair.b);
    const count = Math.max(Math.ceil(stair.rise / MAX_RISER), 2);

    return { count, riser: stair.rise / count, going: run / count };
}

function stairSolids(stair: StairElement, elevation: number): Solid[] {
    const run = distance2(stair.a, stair.b);

    if (run < 100) {
        return [];
    }

    const { count, riser, going } = stairSteps(stair);
    const along = normalize2(subtract2(stair.b, stair.a));
    const side = {
        x: (-along.y * stair.width) / 2,
        y: (along.x * stair.width) / 2,
    };
    const solids: Solid[] = [];

    for (let index = 0; index < count; index++) {
        const from = {
            x: stair.a.x + along.x * going * index,
            y: stair.a.y + along.y * going * index,
        };
        const to = {
            x: stair.a.x + along.x * going * (index + 1),
            y: stair.a.y + along.y * going * (index + 1),
        };

        const footprint = [
            { x: from.x - side.x, y: from.y - side.y },
            { x: to.x - side.x, y: to.y - side.y },
            { x: to.x + side.x, y: to.y + side.y },
            { x: from.x + side.x, y: from.y + side.y },
        ];

        solids.push({
            id: `${stair.id}-step-${index + 1}`,
            name: `Stair step ${index + 1}`,
            category: 'stair',
            elementId: stair.id,
            level: stair.level,
            faces: prism(footprint, elevation, elevation + riser * (index + 1)),
            base: elevation,
        });
    }

    return solids;
}

function beamSolid(beam: BeamElement, elevation: number): Solid | null {
    const length = distance2(beam.a, beam.b);

    if (length < 10) {
        return null;
    }

    const along = normalize2(subtract2(beam.b, beam.a));
    const side = {
        x: (-along.y * beam.width) / 2,
        y: (along.x * beam.width) / 2,
    };
    const footprint = [
        { x: beam.a.x - side.x, y: beam.a.y - side.y },
        { x: beam.b.x - side.x, y: beam.b.y - side.y },
        { x: beam.b.x + side.x, y: beam.b.y + side.y },
        { x: beam.a.x + side.x, y: beam.a.y + side.y },
    ];

    const top = elevation + beam.elevation;

    return {
        id: beam.id,
        name: `Beam ${beam.width}×${beam.depth}`,
        category: 'beam',
        elementId: beam.id,
        level: beam.level,
        faces: prism(footprint, top - beam.depth, top),
        base: top - beam.depth,
    };
}

/* ------------------------------------------------- curtain walls and ramps */

/** Mullion spacing along a curtain wall, in millimetres. */
const CURTAIN_MODULE = 1200;

/** Square mullion section, in millimetres. */
const MULLION = 60;

/**
 * A curtain wall as a glass sheet with square mullions at every module and
 * along the head and sill, replacing the usual poched runs.
 */
function curtainSolids(wall: WallGeometry, elevation: number): Solid[] {
    const bottom = elevation + wall.wall.baseOffset;
    const top = bottom + wall.wall.height;
    const along = wall.direction;
    const side = { x: wall.normal.x * 12, y: wall.normal.y * 12 };
    const solids: Solid[] = [];

    // Glass sheet on the centre line.
    solids.push({
        id: `${wall.wall.id}-glazing`,
        name: 'Curtain glazing',
        category: 'window',
        elementId: wall.wall.id,
        level: wall.wall.level,
        faces: prism(
            [
                { x: wall.a.x - side.x, y: wall.a.y - side.y },
                { x: wall.b.x - side.x, y: wall.b.y - side.y },
                { x: wall.b.x + side.x, y: wall.b.y + side.y },
                { x: wall.a.x + side.x, y: wall.a.y + side.y },
            ],
            bottom + MULLION,
            top - MULLION,
        ),
        base: bottom,
    });

    const modules = Math.max(Math.round(wall.length / CURTAIN_MODULE), 1);

    // Vertical mullions at every module boundary.
    for (let index = 0; index <= modules; index++) {
        const at = lerp(wall.a, wall.b, index / modules);

        solids.push({
            id: `${wall.wall.id}-mullion-${index}`,
            name: 'Mullion',
            category: 'beam',
            elementId: wall.wall.id,
            level: wall.wall.level,
            faces: prism(
                boxAround(at, MULLION, Math.atan2(along.y, along.x)),
                bottom,
                top,
            ),
            base: bottom,
        });
    }

    // Head and sill rails.
    const railFootprint = [
        { x: wall.a.x - side.x * 2, y: wall.a.y - side.y * 2 },
        { x: wall.b.x - side.x * 2, y: wall.b.y - side.y * 2 },
        { x: wall.b.x + side.x * 2, y: wall.b.y + side.y * 2 },
        { x: wall.a.x + side.x * 2, y: wall.a.y + side.y * 2 },
    ];

    solids.push(
        {
            id: `${wall.wall.id}-sill`,
            name: 'Sill rail',
            category: 'beam',
            elementId: wall.wall.id,
            level: wall.wall.level,
            faces: prism(railFootprint, bottom, bottom + MULLION),
            base: bottom,
        },
        {
            id: `${wall.wall.id}-head`,
            name: 'Head rail',
            category: 'beam',
            elementId: wall.wall.id,
            level: wall.wall.level,
            faces: prism(railFootprint, top - MULLION, top),
            base: top - MULLION,
        },
    );

    return solids;
}

/** A ramp as a run of thin wedge slices climbing to its rise. */
function rampSolids(ramp: RampElement, elevation: number): Solid[] {
    const run = Math.hypot(ramp.b.x - ramp.a.x, ramp.b.y - ramp.a.y);

    if (run < 100) {
        return [];
    }

    const slices = Math.max(Math.round(run / 300), 4);
    const along = normalize2({
        x: ramp.b.x - ramp.a.x,
        y: ramp.b.y - ramp.a.y,
    });
    const side = {
        x: (-along.y * ramp.width) / 2,
        y: (along.x * ramp.width) / 2,
    };
    const solids: Solid[] = [];

    for (let index = 0; index < slices; index++) {
        const from = {
            x: ramp.a.x + (along.x * run * index) / slices,
            y: ramp.a.y + (along.y * run * index) / slices,
        };
        const to = {
            x: ramp.a.x + (along.x * run * (index + 1)) / slices,
            y: ramp.a.y + (along.y * run * (index + 1)) / slices,
        };
        const top = elevation + (ramp.rise * (index + 1)) / slices;

        solids.push({
            id: `${ramp.id}-slice-${index + 1}`,
            name: 'Ramp',
            category: 'stair',
            elementId: ramp.id,
            level: ramp.level,
            faces: prism(
                [
                    { x: from.x - side.x, y: from.y - side.y },
                    { x: to.x - side.x, y: to.y - side.y },
                    { x: to.x + side.x, y: to.y + side.y },
                    { x: from.x + side.x, y: from.y + side.y },
                ],
                Math.max(top - 150, elevation),
                top,
            ),
            base: elevation,
        });
    }

    return solids;
}
