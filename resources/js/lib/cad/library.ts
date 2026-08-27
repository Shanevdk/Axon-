/**
 * The model library: reusable items built from parts or imported from files.
 *
 * An item is stored as the same shape `insertMesh()` places — a flat triangle
 * list in millimetres with a plan footprint — so grabbing one from the
 * library is exactly the import path with the parsing already done. Designed
 * items additionally keep their part list, which is what makes them editable
 * again later; an imported file has no parts and never will.
 *
 * Everything here is pure: geometry in, geometry or SVG text out. The
 * thumbnail is an SVG rather than a canvas render so it can be built and
 * tested without a browser, scales cleanly in a grid, and stays small.
 */

import { convexHull, MAX_TRIANGLES } from '@/lib/cad/exchange/mesh-import';
import type { ImportedMesh } from '@/lib/cad/exchange/mesh-import';
import { createId } from '@/lib/cad/model';
import type { Point } from '@/lib/cad/types';

/* ------------------------------------------------------------------ parts */

export type PartShape = 'box' | 'cylinder' | 'sketch';

/**
 * One primitive in a designed item. Positions are millimetres from the item's
 * origin: x across, y deep, z the height of the part's underside.
 */
export type ItemPart = {
    id: string;
    name: string;
    shape: PartShape;
    width: number;
    depth: number;
    height: number;
    x: number;
    y: number;
    z: number;
    /** Rotation about the vertical axis, in degrees. */
    rotation: number;
    /**
     * The outline of a sketch part — drawn with a pencil, a finger or an AI —
     * as a closed polygon in millimetres about the part's own centre. The
     * part's width and depth are kept equal to this outline's extents.
     */
    points?: Point[];
    /**
     * What the part is made of, as a hex colour. Absent means the default
     * material, so old items and AI drafts that say nothing still read well.
     */
    colour?: string;
};

/**
 * The materials a part can be given: real finishes rather than a rainbow, so
 * an item made of them looks like furniture instead of a toy.
 */
export const PART_COLOURS: { name: string; value: string }[] = [
    { name: 'Oak', value: '#c8a578' },
    { name: 'Walnut', value: '#6b4a33' },
    { name: 'Ash', value: '#ddcdb4' },
    { name: 'Charcoal', value: '#3a3a3c' },
    { name: 'Linen', value: '#d8d2c6' },
    { name: 'Ochre', value: '#c58a3d' },
    { name: 'Olive', value: '#6f7551' },
    { name: 'Rust', value: '#a8543a' },
    { name: 'Slate', value: '#5b6870' },
    { name: 'Brass', value: '#b08d46' },
    { name: 'Steel', value: '#9aa3a8' },
    { name: 'Paper', value: '#efece6' },
];

/** What a part is drawn in when it has been given no material. */
export const DEFAULT_PART_COLOUR = '#b9b2a7';

/** Sides on a cylinder — enough to read as round in a thumbnail and a plan. */
const CYLINDER_SEGMENTS = 12;

/** The most parts one item may carry; past this it should be a file import. */
export const MAX_PARTS = 100;

export function newPart(shape: PartShape, name?: string): ItemPart {
    return {
        id: createId('part'),
        name: name ?? (shape === 'box' ? 'Box' : 'Cylinder'),
        shape,
        width: 600,
        depth: 600,
        height: 400,
        x: 0,
        y: 0,
        z: 0,
        rotation: 0,
    };
}

/* --------------------------------------------------------------- compiling */

/**
 * Turn a part list into the mesh the document stores, normalised the way a
 * family expects to be placed: footprint centred on the origin, underside
 * sitting at z zero.
 */
export function compileParts(name: string, parts: ItemPart[]): ImportedMesh {
    return compileScene(name, parts).mesh;
}

/**
 * One part's own geometry, after the whole item has been centred — what the
 * viewport shades, highlights and picks.
 */
export type ScenePiece = {
    partId: string;
    name: string;
    colour: string;
    /** Flat triangle list, nine numbers each, in the item's own frame. */
    vertices: number[];
};

export type ItemScene = {
    mesh: ImportedMesh;
    pieces: ScenePiece[];
};

/**
 * Compile the parts once, keeping each part's triangles separately.
 *
 * The viewport needs to know which triangles belong to which part in order
 * to colour and highlight them; the document only wants the whole soup. Both
 * come from here so they can never disagree about where a part sits.
 */
export function compileScene(name: string, parts: ItemPart[]): ItemScene {
    const built = parts.map((part) => ({
        part,
        vertices:
            part.shape === 'box'
                ? boxTriangles(part)
                : part.shape === 'cylinder'
                  ? cylinderTriangles(part)
                  : sketchTriangles(part),
    }));

    const all = built.flatMap((piece) => piece.vertices);

    if (all.length === 0) {
        return {
            mesh: {
                name,
                vertices: [],
                footprint: [],
                size: { x: 0, y: 0, z: 0 },
                triangleCount: 0,
            },
            pieces: [],
        };
    }

    const mesh = normalise(name, all);
    const shift = [
        mesh.vertices[0] - all[0],
        mesh.vertices[1] - all[1],
        mesh.vertices[2] - all[2],
    ];

    return {
        mesh,
        pieces: built
            .filter((piece) => piece.vertices.length > 0)
            .map((piece) => ({
                partId: piece.part.id,
                name: piece.part.name,
                colour: piece.part.colour ?? DEFAULT_PART_COLOUR,
                // The same shift normalise() applied to the whole item, so a
                // piece lands exactly where its triangles do in the mesh.
                vertices: piece.vertices.map(
                    (value, index) => value + shift[index % 3],
                ),
            })),
    };
}

/**
 * Re-centre a triangle soup so placement is predictable, and measure it.
 */
export function normalise(name: string, vertices: number[]): ImportedMesh {
    const bounds = {
        min: [Infinity, Infinity, Infinity],
        max: [-Infinity, -Infinity, -Infinity],
    };

    for (let index = 0; index < vertices.length; index += 3) {
        for (let axis = 0; axis < 3; axis++) {
            bounds.min[axis] = Math.min(
                bounds.min[axis],
                vertices[index + axis],
            );
            bounds.max[axis] = Math.max(
                bounds.max[axis],
                vertices[index + axis],
            );
        }
    }

    const shift = [
        -(bounds.min[0] + bounds.max[0]) / 2,
        -(bounds.min[1] + bounds.max[1]) / 2,
        -bounds.min[2],
    ];

    const shifted = vertices.map((value, index) => value + shift[index % 3]);

    const plan: Point[] = [];

    for (let index = 0; index < shifted.length; index += 3) {
        plan.push({ x: shifted[index], y: shifted[index + 1] });
    }

    return {
        name,
        vertices: shifted,
        footprint: convexHull(plan),
        size: {
            x: bounds.max[0] - bounds.min[0],
            y: bounds.max[1] - bounds.min[1],
            z: bounds.max[2] - bounds.min[2],
        },
        triangleCount: shifted.length / 9,
    };
}

function spin(part: ItemPart): (x: number, y: number) => [number, number] {
    const radians = (part.rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);

    return (x, y) => [part.x + x * cos - y * sin, part.y + x * sin + y * cos];
}

function boxTriangles(part: ItemPart): number[] {
    const turn = spin(part);
    const hw = part.width / 2;
    const hd = part.depth / 2;
    const z0 = part.z;
    const z1 = part.z + part.height;

    // The four plan corners, counter-clockwise seen from above.
    const corners: [number, number][] = [
        turn(-hw, -hd),
        turn(hw, -hd),
        turn(hw, hd),
        turn(-hw, hd),
    ];

    const triangles: number[] = [];
    const quad = (
        a: [number, number, number],
        b: [number, number, number],
        c: [number, number, number],
        d: [number, number, number],
    ) => triangles.push(...a, ...b, ...c, ...a, ...c, ...d);

    const low = corners.map(([x, y]): [number, number, number] => [x, y, z0]);
    const high = corners.map(([x, y]): [number, number, number] => [x, y, z1]);

    // Top faces up, bottom faces down, and each side winds outward.
    quad(high[0], high[1], high[2], high[3]);
    quad(low[3], low[2], low[1], low[0]);

    for (let side = 0; side < 4; side++) {
        const next = (side + 1) % 4;
        quad(low[side], low[next], high[next], high[side]);
    }

    return triangles;
}

/* --------------------------------------------------------------- sketching */

/**
 * Split a simple polygon into triangles by ear clipping. Returns index
 * triples into the outline, counter-clockwise. A degenerate outline gives
 * back whatever could be clipped rather than throwing — a half-built shape
 * beats a dead sketch pad.
 */
export function triangulateOutline(
    points: Point[],
): [number, number, number][] {
    if (points.length < 3) {
        return [];
    }

    let area = 0;

    for (let index = 0; index < points.length; index++) {
        const a = points[index];
        const b = points[(index + 1) % points.length];
        area += a.x * b.y - b.x * a.y;
    }

    const ring = [...points.keys()];

    if (area < 0) {
        ring.reverse();
    }

    const ears: [number, number, number][] = [];
    let guard = points.length * points.length + 10;

    while (ring.length > 3 && guard-- > 0) {
        let clipped = false;

        for (let at = 0; at < ring.length; at++) {
            const prev = ring[(at - 1 + ring.length) % ring.length];
            const here = ring[at];
            const next = ring[(at + 1) % ring.length];
            const a = points[prev];
            const b = points[here];
            const c = points[next];

            const cross = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);

            // A reflex corner is not an ear.
            if (cross <= 0) {
                continue;
            }

            const blocked = ring.some(
                (other) =>
                    other !== prev &&
                    other !== here &&
                    other !== next &&
                    pointInTriangle(points[other], a, b, c),
            );

            if (blocked) {
                continue;
            }

            ears.push([prev, here, next]);
            ring.splice(at, 1);
            clipped = true;
            break;
        }

        if (!clipped) {
            break;
        }
    }

    if (ring.length === 3) {
        ears.push([ring[0], ring[1], ring[2]]);
    }

    return ears;
}

function pointInTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
    const sign = (u: Point, v: Point, w: Point): number =>
        (v.x - u.x) * (w.y - u.y) - (w.x - u.x) * (v.y - u.y);

    const first = sign(a, b, p);
    const second = sign(b, c, p);
    const third = sign(c, a, p);

    const anyNegative = first < 0 || second < 0 || third < 0;
    const anyPositive = first > 0 || second > 0 || third > 0;

    return !(anyNegative && anyPositive);
}

/**
 * Thin a drawn stroke to its corners — Ramer–Douglas–Peucker. A finger
 * leaves hundreds of points; a couch outline needs a couple of dozen.
 */
export function simplifyStroke(points: Point[], epsilon: number): Point[] {
    if (points.length <= 2) {
        return points;
    }

    const first = points[0];
    const last = points[points.length - 1];
    let furthest = 0;
    let at = 0;

    for (let index = 1; index < points.length - 1; index++) {
        const away = distanceToSegment(points[index], first, last);

        if (away > furthest) {
            furthest = away;
            at = index;
        }
    }

    if (furthest <= epsilon) {
        return [first, last];
    }

    const head = simplifyStroke(points.slice(0, at + 1), epsilon);
    const tail = simplifyStroke(points.slice(at), epsilon);

    return [...head.slice(0, -1), ...tail];
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) {
        return Math.hypot(p.x - a.x, p.y - a.y);
    }

    const t = Math.max(
        0,
        Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared),
    );

    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Make a sketch part out of a drawn outline: centred on its own bounding
 * box, with width and depth reading the outline's true extents.
 */
export function newSketchPart(outline: Point[], name = 'Sketch'): ItemPart {
    const xs = outline.map((point) => point.x);
    const ys = outline.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const points = outline.map((point) => ({
        x: point.x - (minX + maxX) / 2,
        y: point.y - (minY + maxY) / 2,
    }));

    return {
        ...newPart('sketch', name),
        shape: 'sketch',
        width: Math.max(1, maxX - minX),
        depth: Math.max(1, maxY - minY),
        points,
    };
}

/**
 * Resize a part, scaling a sketch outline so its extents follow the numbers
 * the way a box's do.
 */
export function resizePart(
    part: ItemPart,
    values: { width?: number; depth?: number },
): ItemPart {
    const width = Math.max(1, values.width ?? part.width);
    const depth = Math.max(1, values.depth ?? part.depth);

    if (part.shape !== 'sketch' || !part.points) {
        return { ...part, width, depth };
    }

    const scaleX = width / Math.max(1, part.width);
    const scaleY = depth / Math.max(1, part.depth);

    return {
        ...part,
        width,
        depth,
        points: part.points.map((point) => ({
            x: point.x * scaleX,
            y: point.y * scaleY,
        })),
    };
}

function sketchTriangles(part: ItemPart): number[] {
    const outline = part.points ?? [];
    const ears = triangulateOutline(outline);

    if (ears.length === 0) {
        return [];
    }

    const turn = spin(part);
    const z0 = part.z;
    const z1 = part.z + part.height;

    // Work on the outline in the winding the ears were clipped in, so the
    // sides face outward regardless of which way the stroke was drawn.
    let area = 0;

    for (let index = 0; index < outline.length; index++) {
        const a = outline[index];
        const b = outline[(index + 1) % outline.length];
        area += a.x * b.y - b.x * a.y;
    }

    const ring = area < 0 ? [...outline].reverse() : outline;
    const placed = ring.map((point) => turn(point.x, point.y));
    const cap = (index: number): [number, number] => {
        const point = outline[index];

        return turn(point.x, point.y);
    };

    const triangles: number[] = [];

    for (const [a, b, c] of ears) {
        const [ax, ay] = cap(a);
        const [bx, by] = cap(b);
        const [cx, cy] = cap(c);

        // Top faces up; the bottom is the same fan reversed.
        triangles.push(ax, ay, z1, bx, by, z1, cx, cy, z1);
        triangles.push(ax, ay, z0, cx, cy, z0, bx, by, z0);
    }

    for (let index = 0; index < placed.length; index++) {
        const [ax, ay] = placed[index];
        const [bx, by] = placed[(index + 1) % placed.length];

        triangles.push(ax, ay, z0, bx, by, z0, bx, by, z1);
        triangles.push(ax, ay, z0, bx, by, z1, ax, ay, z1);
    }

    return triangles;
}

function cylinderTriangles(part: ItemPart): number[] {
    const turn = spin(part);
    const rx = part.width / 2;
    const ry = part.depth / 2;
    const z0 = part.z;
    const z1 = part.z + part.height;

    const ring: [number, number][] = [];

    for (let segment = 0; segment < CYLINDER_SEGMENTS; segment++) {
        const angle = (segment / CYLINDER_SEGMENTS) * Math.PI * 2;
        ring.push(turn(Math.cos(angle) * rx, Math.sin(angle) * ry));
    }

    const centre = turn(0, 0);
    const triangles: number[] = [];

    for (let segment = 0; segment < CYLINDER_SEGMENTS; segment++) {
        const [ax, ay] = ring[segment];
        const [bx, by] = ring[(segment + 1) % CYLINDER_SEGMENTS];

        // Caps: a fan from the centre, top up and bottom down.
        triangles.push(centre[0], centre[1], z1, ax, ay, z1, bx, by, z1);
        triangles.push(centre[0], centre[1], z0, bx, by, z0, ax, ay, z0);

        // The side, wound outward.
        triangles.push(ax, ay, z0, bx, by, z0, bx, by, z1);
        triangles.push(ax, ay, z0, bx, by, z1, ax, ay, z1);
    }

    return triangles;
}

/* ---------------------------------------------------------------- snapshot */

/** Faces beyond this are dropped by size — it is a thumbnail, not a viewer. */
const SNAPSHOT_FACE_LIMIT = 1500;

/** Isometric-ish camera the snapshot always uses. */
const SNAPSHOT_AZIMUTH = -Math.PI / 4;
const SNAPSHOT_ELEVATION = Math.PI / 6.5;

/**
 * Draw a mesh as a small shaded SVG, returned as a data URL ready for an
 * <img> or an <html img src>. Deterministic for a given mesh.
 */
export function itemSnapshot(
    vertices: number[],
    /**
     * The pieces the triangles came from, so the thumbnail carries the item's
     * materials. Omit it and the whole thing is drawn in one neutral tone.
     */
    pieces: ScenePiece[] = [],
): string {
    const cosA = Math.cos(SNAPSHOT_AZIMUTH);
    const sinA = Math.sin(SNAPSHOT_AZIMUTH);
    const cosE = Math.cos(SNAPSHOT_ELEVATION);
    const sinE = Math.sin(SNAPSHOT_ELEVATION);

    type Face = {
        points: [number, number][];
        depth: number;
        shade: number;
        colour: [number, number, number];
    };

    const faces: Face[] = [];

    // Light from the upper left, fixed, so every thumbnail matches.
    const light = unit([-0.45, 0.35, 0.82]);

    // Which triangle each piece starts at, so a face knows its material.
    const bands: { until: number; colour: [number, number, number] }[] = [];
    let running = 0;

    for (const piece of pieces) {
        running += piece.vertices.length;
        bands.push({ until: running, colour: readHex(piece.colour) });
    }

    const colourAt = (index: number): [number, number, number] =>
        bands.find((band) => index < band.until)?.colour ??
        readHex(DEFAULT_PART_COLOUR);

    for (let index = 0; index + 8 < vertices.length; index += 9) {
        const corners: [number, number][] = [];
        let depth = 0;

        for (let corner = 0; corner < 3; corner++) {
            const x = vertices[index + corner * 3];
            const y = vertices[index + corner * 3 + 1];
            const z = vertices[index + corner * 3 + 2];

            // Rotate the plan under the camera, then tilt.
            const px = x * cosA - y * sinA;
            const py = x * sinA + y * cosA;

            corners.push([px, -(z * cosE - py * sinE)]);
            depth += py * cosE + z * sinE;
        }

        const normal = triangleNormal(vertices, index);

        // Faces looking away are never seen under a fixed camera.
        if (faceToViewer(normal, sinA, cosA, sinE, cosE) <= 0) {
            continue;
        }

        faces.push({
            points: corners,
            depth: depth / 3,
            shade: Math.max(0.25, dot(normal, light)),
            colour: colourAt(index),
        });
    }

    const kept = faces
        .sort((a, b) => area(b.points) - area(a.points))
        .slice(0, SNAPSHOT_FACE_LIMIT)
        .sort((a, b) => a.depth - b.depth);

    if (kept.length === 0) {
        return emptySnapshot();
    }

    const xs = kept.flatMap((face) => face.points.map((point) => point[0]));
    const ys = kept.flatMap((face) => face.points.map((point) => point[1]));
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const width = Math.max(1, Math.max(...xs) - minX);
    const height = Math.max(1, Math.max(...ys) - minY);
    const margin = Math.max(width, height) * 0.06;

    const polygons = kept
        .map((face) => {
            // Ambient floor plus the lit share, so a shadowed face keeps its
            // material rather than going black.
            const lit = 0.32 + face.shade * 0.78;
            const [r, g, b] = face.colour.map((channel) =>
                Math.max(0, Math.min(255, Math.round(channel * lit))),
            );
            const points = face.points
                .map(
                    (point) =>
                        `${(point[0] - minX).toFixed(1)},${(point[1] - minY).toFixed(1)}`,
                )
                .join(' ');

            return `<polygon points="${points}" fill="rgb(${r},${g},${b})"/>`;
        })
        .join('');

    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${(-margin).toFixed(1)} ${(-margin).toFixed(1)} ` +
        `${(width + margin * 2).toFixed(1)} ${(height + margin * 2).toFixed(1)}">${polygons}</svg>`;

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function emptySnapshot(): string {
    const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function triangleNormal(
    vertices: number[],
    index: number,
): [number, number, number] {
    const ax = vertices[index];
    const ay = vertices[index + 1];
    const az = vertices[index + 2];
    const u = [
        vertices[index + 3] - ax,
        vertices[index + 4] - ay,
        vertices[index + 5] - az,
    ];
    const v = [
        vertices[index + 6] - ax,
        vertices[index + 7] - ay,
        vertices[index + 8] - az,
    ];

    return unit([
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
    ]);
}

/** How much a face looks at the fixed snapshot camera. */
function faceToViewer(
    normal: [number, number, number],
    sinA: number,
    cosA: number,
    sinE: number,
    cosE: number,
): number {
    // Depth grows along py·cosE + z·sinE, so this is the direction from the
    // model toward the camera in world space.
    const toCamera: [number, number, number] = [sinA * cosE, cosA * cosE, sinE];

    return dot(normal, toCamera);
}

/**
 * Read `#rrggbb` into channels, falling back to the default material rather
 * than throwing — a colour arriving from an AI draft may be anything.
 */
export function readHex(colour: string): [number, number, number] {
    const match = /^#?([0-9a-f]{6})$/i.exec(colour.trim());

    if (!match) {
        return colour === DEFAULT_PART_COLOUR
            ? [185, 178, 167]
            : readHex(DEFAULT_PART_COLOUR);
    }

    const value = parseInt(match[1], 16);

    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function unit(vector: number[]): [number, number, number] {
    const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;

    return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function dot(a: number[], b: number[]): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function area(points: [number, number][]): number {
    const [a, b, c] = points;

    return (
        Math.abs(
            (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]),
        ) / 2
    );
}

/* ----------------------------------------------------------------- presets */

export type ItemPreset = {
    name: string;
    category: string;
    parts: Omit<ItemPart, 'id'>[];
};

const part = (
    name: string,
    shape: PartShape,
    width: number,
    depth: number,
    height: number,
    x = 0,
    y = 0,
    z = 0,
    rotation = 0,
    colour = DEFAULT_PART_COLOUR,
): Omit<ItemPart, 'id'> => ({
    name,
    shape,
    colour,
    width,
    depth,
    height,
    x,
    y,
    z,
    rotation,
});

/**
 * Starting points, sized from furniture that actually exists. Loading one
 * replaces the part list; every number is then the designer's to change.
 */
/** The materials the presets are made of, named where they are used. */
const [OAK, WALNUT, ASH, CHARCOAL, LINEN, OLIVE, BRASS, PAPER] = [
    '#c8a578',
    '#6b4a33',
    '#ddcdb4',
    '#3a3a3c',
    '#d8d2c6',
    '#6f7551',
    '#b08d46',
    '#efece6',
];

export const ITEM_PRESETS: ItemPreset[] = [
    {
        name: 'Couch',
        category: 'Furniture',
        parts: [
            part('Seat', 'box', 1800, 900, 420, 0, 0, 0, 0, LINEN),
            part('Back', 'box', 1800, 200, 580, 0, -350, 350, 0, LINEN),
            part('Left arm', 'box', 220, 900, 580, -790, 0, 0, 0, LINEN),
            part('Right arm', 'box', 220, 900, 580, 790, 0, 0, 0, LINEN),
        ],
    },
    {
        name: 'Armchair',
        category: 'Furniture',
        parts: [
            part('Seat', 'box', 900, 850, 420, 0, 0, 0, 0, OLIVE),
            part('Back', 'box', 900, 200, 560, 0, -325, 330, 0, OLIVE),
            part('Left arm', 'box', 200, 850, 560, -350, 0, 0, 0, OLIVE),
            part('Right arm', 'box', 200, 850, 560, 350, 0, 0, 0, OLIVE),
        ],
    },
    {
        name: 'Dining table',
        category: 'Furniture',
        parts: [
            part('Top', 'box', 1600, 900, 40, 0, 0, 700, 0, OAK),
            part('Leg', 'cylinder', 60, 60, 700, -720, -370, 0, 0, WALNUT),
            part('Leg', 'cylinder', 60, 60, 700, 720, -370, 0, 0, WALNUT),
            part('Leg', 'cylinder', 60, 60, 700, 720, 370, 0, 0, WALNUT),
            part('Leg', 'cylinder', 60, 60, 700, -720, 370, 0, 0, WALNUT),
        ],
    },
    {
        name: 'Coffee table',
        category: 'Furniture',
        parts: [
            part('Top', 'box', 1100, 600, 35, 0, 0, 415, 0, WALNUT),
            part('Shelf', 'box', 1000, 520, 25, 0, 0, 150, 0, WALNUT),
            part('Leg', 'box', 40, 40, 415, -510, -260, 0, 0, CHARCOAL),
            part('Leg', 'box', 40, 40, 415, 510, -260, 0, 0, CHARCOAL),
            part('Leg', 'box', 40, 40, 415, 510, 260, 0, 0, CHARCOAL),
            part('Leg', 'box', 40, 40, 415, -510, 260, 0, 0, CHARCOAL),
        ],
    },
    {
        name: 'Bed',
        category: 'Furniture',
        parts: [
            part('Base', 'box', 1600, 2000, 300, 0, 0, 0, 0, WALNUT),
            part('Mattress', 'box', 1520, 1920, 220, 0, 0, 300, 0, PAPER),
            part('Headboard', 'box', 1600, 80, 1100, 0, -960, 0, 0, WALNUT),
        ],
    },
    {
        name: 'Bookshelf',
        category: 'Furniture',
        parts: [
            part('Left side', 'box', 30, 350, 2100, -435, 0, 0, 0, ASH),
            part('Right side', 'box', 30, 350, 2100, 435, 0, 0, 0, ASH),
            part('Back', 'box', 900, 20, 2100, 0, 165, 0, 0, PAPER),
            part('Shelf', 'box', 840, 330, 25, 0, 0, 0, 0, ASH),
            part('Shelf', 'box', 840, 330, 25, 0, 0, 520, 0, ASH),
            part('Shelf', 'box', 840, 330, 25, 0, 0, 1040, 0, ASH),
            part('Shelf', 'box', 840, 330, 25, 0, 0, 1560, 0, ASH),
            part('Top', 'box', 900, 350, 30, 0, 0, 2070, 0, ASH),
        ],
    },
    {
        name: 'Floor lamp',
        category: 'Lighting',
        parts: [
            part('Base', 'cylinder', 300, 300, 30, 0, 0, 0, 0, CHARCOAL),
            part('Pole', 'cylinder', 40, 40, 1350, 0, 0, 30, 0, BRASS),
            part('Shade', 'cylinder', 380, 380, 280, 0, 0, 1380, 0, LINEN),
        ],
    },
];

/* ------------------------------------------------------------- the payload */

/**
 * A shelved item as the listing endpoints describe one — everything but the
 * geometry, which is fetched only at the moment of placing.
 */
export type ShelfItem = {
    id: number;
    name: string;
    category: string;
    kind: 'imported' | 'designed';
    thumbnail: string;
    triangles: number;
    editable: boolean;
    author: string | null;
    created_at: string | null;
};

/**
 * What a library item stores. Designed items keep their parts so they can be
 * opened in the designer again; imported files carry geometry only.
 */
export type LibraryPayload = {
    vertices: number[];
    footprint: Point[];
    size: { x: number; y: number; z: number };
    triangleCount: number;
    parts?: ItemPart[];
};

export function payloadFromMesh(
    mesh: ImportedMesh,
    parts?: ItemPart[],
): LibraryPayload {
    return {
        vertices: mesh.vertices,
        footprint: mesh.footprint,
        size: mesh.size,
        triangleCount: mesh.triangleCount,
        ...(parts ? { parts } : {}),
    };
}

/**
 * Rebuild the mesh `insertMesh()` places from a stored payload.
 */
export function meshFromPayload(
    name: string,
    payload: LibraryPayload,
): ImportedMesh {
    return {
        name,
        vertices: payload.vertices,
        footprint: payload.footprint,
        size: payload.size,
        triangleCount: payload.triangleCount,
    };
}

export { MAX_TRIANGLES };
