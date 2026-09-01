/**
 * IFC, which is how a model gets in and out of Revit.
 *
 * There is no reading a `.rvt`. It is a closed binary format with no
 * published specification, and nothing outside Autodesk's own software opens
 * one — so the honest route, and the one the industry actually uses, is IFC:
 * Revit writes it from File → Export → IFC, and reads it back on import.
 * ISO 16739, and an open format we can meet them on.
 *
 * What comes back is a building, not a mesh. A wall arrives as a wall with a
 * thickness and a centre line, a slab as a floor with its outline, a space as
 * a room — because a model that arrives as one lump of triangles is a picture
 * of a building rather than a building. Anything whose geometry is not one of
 * the shapes below still comes in, as a mesh, so nothing is silently dropped.
 */

import { convexHull } from '@/lib/cad/exchange/mesh-import';
import {
    asNumber,
    asNumbers,
    asString,
    deref,
    derefAll,
    parseSpf,
    SpfParseError,
} from '@/lib/cad/exchange/spf';
import type { SpfEntity, SpfFile } from '@/lib/cad/exchange/spf';
import type { Solid } from '@/lib/cad/solids';
import type {
    CadElement,
    ColumnElement,
    FloorElement,
    MeshElement,
    Point,
    RoomElement,
    WallElement,
} from '@/lib/cad/types';

export class IfcImportError extends Error {}

/* ==================================================================== in */

export type IfcImport = {
    elements: CadElement[];
    /** What came in, by kind, for the dialog to report. */
    counts: { walls: number; floors: number; columns: number; rooms: number; meshes: number };
    /** Products found that carried no geometry we could read. */
    skipped: number;
    schema: string | null;
};

/** IFC types that become a wall. */
const WALL_TYPES = ['IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCWALLELEMENTEDCASE'];

/** IFC types that become a floor. */
const SLAB_TYPES = ['IFCSLAB', 'IFCSLABSTANDARDCASE', 'IFCPLATE'];

const COLUMN_TYPES = ['IFCCOLUMN', 'IFCCOLUMNSTANDARDCASE'];

/** Everything else worth bringing in, as geometry. */
const OTHER_TYPES = [
    'IFCBEAM',
    'IFCROOF',
    'IFCSTAIR',
    'IFCSTAIRFLIGHT',
    'IFCRAILING',
    'IFCDOOR',
    'IFCWINDOW',
    'IFCFURNISHINGELEMENT',
    'IFCBUILDINGELEMENTPROXY',
    'IFCCOVERING',
    'IFCMEMBER',
    'IFCFOOTING',
];

/**
 * Read an IFC file into elements.
 *
 * @throws IfcImportError when the file is not IFC, or holds no building
 */
export function importIfc(text: string, level: string): IfcImport {
    let file: SpfFile;

    try {
        file = parseSpf(text);
    } catch (thrown) {
        throw new IfcImportError(
            thrown instanceof SpfParseError
                ? thrown.message
                : 'That file could not be read as IFC.',
        );
    }

    if (file.schema && !/^IFC/i.test(file.schema)) {
        throw new IfcImportError(
            `That is a STEP file in the ${file.schema} schema, not an IFC model.`,
        );
    }

    const scale = lengthScale(file);
    const elements: CadElement[] = [];
    const counts = { walls: 0, floors: 0, columns: 0, rooms: 0, meshes: 0 };
    let skipped = 0;
    let serial = 0;

    const take = (entity: SpfEntity, made: CadElement | null): void => {
        if (made) {
            elements.push(made);

            return;
        }

        const mesh = meshFrom(file, entity, scale, level, `ifc-mesh-${++serial}`);

        if (mesh) {
            elements.push(mesh);
            counts.meshes += 1;

            return;
        }

        skipped += 1;
    };

    const of = (types: string[]): SpfEntity[] =>
        types.flatMap((type) => file.byType.get(type) ?? []);

    of(WALL_TYPES).forEach((entity) => {
        const wall = wallFrom(file, entity, scale, level, `ifc-wall-${++serial}`);

        if (wall) {
            counts.walls += 1;
        }

        take(entity, wall);
    });

    of(SLAB_TYPES).forEach((entity) => {
        const floor = floorFrom(file, entity, scale, level, `ifc-floor-${++serial}`);

        if (floor) {
            counts.floors += 1;
        }

        take(entity, floor);
    });

    of(COLUMN_TYPES).forEach((entity) => {
        const column = columnFrom(file, entity, scale, level, `ifc-col-${++serial}`);

        if (column) {
            counts.columns += 1;
        }

        take(entity, column);
    });

    (file.byType.get('IFCSPACE') ?? []).forEach((entity) => {
        const room = roomFrom(file, entity, scale, level, `ifc-room-${++serial}`);

        if (room) {
            elements.push(room);
            counts.rooms += 1;
        }
    });

    of(OTHER_TYPES).forEach((entity) => take(entity, null));

    if (elements.length === 0) {
        throw new IfcImportError(
            'No walls, slabs or other building elements were found in that IFC.',
        );
    }

    return { elements, counts, skipped, schema: file.schema };
}

/* -------------------------------------------------------------- units */

/**
 * Millimetres per unit of the file.
 *
 * IFC states its own units, and a model from a metric Revit is in metres
 * while one from an imperial template is in feet. Getting this wrong scales
 * a house by a thousand, so it is read rather than assumed.
 */
function lengthScale(file: SpfFile): number {
    const PREFIX: Record<string, number> = {
        MILLI: 1,
        CENTI: 10,
        DECI: 100,
        NONE: 1000,
        DECA: 10_000,
        HECTO: 100_000,
        KILO: 1_000_000,
    };

    const isLength = (unit: SpfEntity): boolean =>
        unit.args[1]?.kind === 'enum' && unit.args[1].value === 'LENGTHUNIT';

    /**
     * Feet and inches arrive as a factor onto an SI unit. The SI unit it is
     * measured against is in the file too, so this has to be preferred over
     * it rather than merely looked for — an imperial model carries both, and
     * taking the metre would silently scale the building by 3.28.
     */
    const converted = (unit: SpfEntity): number | null => {
        const factor = deref(file, unit.args[3]);
        const value = asNumber(factor?.args[0]);

        return value === null ? null : value * 1000;
    };

    const si = (unit: SpfEntity): number => {
        const prefix = unit.args[2];

        return PREFIX[prefix?.kind === 'enum' ? prefix.value : 'NONE'] ?? 1000;
    };

    // What the file says it is using, in the order it assigns them.
    for (const assignment of file.byType.get('IFCUNITASSIGNMENT') ?? []) {
        for (const unit of derefAll(file, assignment.args[0])) {
            if (!isLength(unit)) {
                continue;
            }

            if (unit.type === 'IFCCONVERSIONBASEDUNIT') {
                const factor = converted(unit);

                if (factor !== null) {
                    return factor;
                }
            }

            if (unit.type === 'IFCSIUNIT') {
                return si(unit);
            }
        }
    }

    // No assignment to read. Fall back to the units themselves, still
    // preferring a conversion, for the reason above.
    for (const unit of file.byType.get('IFCCONVERSIONBASEDUNIT') ?? []) {
        if (isLength(unit)) {
            const factor = converted(unit);

            if (factor !== null) {
                return factor;
            }
        }
    }

    for (const unit of file.byType.get('IFCSIUNIT') ?? []) {
        if (isLength(unit)) {
            return si(unit);
        }
    }

    // Nothing said. Metres is the IFC default and by far the likeliest.
    return 1000;
}

/* --------------------------------------------------------- placements */

/** A placement, as the plan sees it: where, and turned how far. */
type Placement = { x: number; y: number; z: number; angle: number };

const ORIGIN: Placement = { x: 0, y: 0, z: 0, angle: 0 };

/**
 * Where a product sits in the world.
 *
 * IFC nests placements — a wall is placed relative to its storey, which is
 * placed relative to the building — so this walks up the chain and adds them
 * together. Only rotation about the vertical is carried: a wall tipped out of
 * plumb is not something the plan can hold, and pretending otherwise would
 * put it somewhere wrong rather than somewhere approximate.
 */
function placementOf(
    file: SpfFile,
    product: SpfEntity,
    scale: number,
): Placement {
    let placement = deref(file, product.args[5]);
    let found = ORIGIN;
    let guard = 0;

    while (placement && guard++ < 32) {
        if (placement.type !== 'IFCLOCALPLACEMENT') {
            break;
        }

        const local = axisPlacement(file, deref(file, placement.args[1]), scale);

        // Working up the chain, so each parent turns and moves what is
        // already found beneath it.
        const cos = Math.cos(local.angle);
        const sin = Math.sin(local.angle);

        found = {
            x: local.x + found.x * cos - found.y * sin,
            y: local.y + found.x * sin + found.y * cos,
            z: local.z + found.z,
            angle: local.angle + found.angle,
        };

        placement = deref(file, placement.args[0]);
    }

    return found;
}

function axisPlacement(
    file: SpfFile,
    entity: SpfEntity | null,
    scale: number,
): Placement {
    if (!entity) {
        return ORIGIN;
    }

    const point = asNumbers(deref(file, entity.args[0])?.args[0]);
    // Argument 2 is the reference direction, which is the local X axis.
    const reference = asNumbers(deref(file, entity.args[2])?.args[0]);

    return {
        x: (point[0] ?? 0) * scale,
        y: (point[1] ?? 0) * scale,
        z: (point[2] ?? 0) * scale,
        angle:
            reference.length >= 2
                ? Math.atan2(reference[1], reference[0])
                : 0,
    };
}

/** A local point, put where its placement says it goes. */
function place(placement: Placement, x: number, y: number): Point {
    const cos = Math.cos(placement.angle);
    const sin = Math.sin(placement.angle);

    return {
        x: placement.x + x * cos - y * sin,
        y: placement.y + x * sin + y * cos,
    };
}

/* ------------------------------------------------------- the geometry */

/** Every shape representation item on a product. */
function shapeItems(file: SpfFile, product: SpfEntity): SpfEntity[] {
    const shape = deref(file, product.args[6]);

    if (!shape) {
        return [];
    }

    return derefAll(file, shape.args[2]).flatMap((representation) =>
        derefAll(file, representation.args[3]),
    );
}

/** The first extruded solid on a product, which is how most of IFC is made. */
function extrusionOf(file: SpfFile, product: SpfEntity): SpfEntity | null {
    for (const item of shapeItems(file, product)) {
        if (item.type === 'IFCEXTRUDEDAREASOLID') {
            return item;
        }

        // Revit wraps a cut wall in a boolean; the first operand is the body.
        if (item.type === 'IFCBOOLEANCLIPPINGRESULT' || item.type === 'IFCBOOLEANRESULT') {
            const first = deref(file, item.args[1]);

            if (first?.type === 'IFCEXTRUDEDAREASOLID') {
                return first;
            }
        }
    }

    return null;
}

/** The outline of a profile, in its own coordinates. */
function profilePoints(file: SpfFile, profile: SpfEntity, scale: number): Point[] {
    if (profile.type === 'IFCRECTANGLEPROFILEDEF') {
        const width = (asNumber(profile.args[3]) ?? 0) * scale;
        const depth = (asNumber(profile.args[4]) ?? 0) * scale;
        const half = { x: width / 2, y: depth / 2 };

        return [
            { x: -half.x, y: -half.y },
            { x: half.x, y: -half.y },
            { x: half.x, y: half.y },
            { x: -half.x, y: half.y },
        ];
    }

    if (
        profile.type === 'IFCARBITRARYCLOSEDPROFILEDEF' ||
        profile.type === 'IFCARBITRARYPROFILEDEFWITHVOIDS'
    ) {
        const curve = deref(file, profile.args[2]);

        if (curve?.type === 'IFCPOLYLINE') {
            const points = derefAll(file, curve.args[0]).map((point) => {
                const numbers = asNumbers(point.args[0]);

                return {
                    x: (numbers[0] ?? 0) * scale,
                    y: (numbers[1] ?? 0) * scale,
                };
            });

            // A closed polyline repeats its first point; a polygon should not.
            if (
                points.length > 2 &&
                Math.hypot(
                    points[0].x - points[points.length - 1].x,
                    points[0].y - points[points.length - 1].y,
                ) < 0.001
            ) {
                points.pop();
            }

            return points;
        }
    }

    return [];
}

/** The profile a solid is swept from, taken through its own placement. */
function sweptOutline(
    file: SpfFile,
    extrusion: SpfEntity,
    scale: number,
): Point[] {
    const profile = deref(file, extrusion.args[0]);

    if (!profile) {
        return [];
    }

    const points = profilePoints(file, profile, scale);

    if (points.length === 0) {
        return [];
    }

    // A profile carries its own placement inside the solid, which is what
    // puts a rectangle on the wall's centre line rather than at the origin.
    const local =
        profile.type === 'IFCRECTANGLEPROFILEDEF'
            ? axisPlacement2d(file, deref(file, profile.args[2]), scale)
            : ORIGIN;

    const solid = axisPlacement(file, deref(file, extrusion.args[1]), scale);

    return points.map((point) => {
        const inProfile = place(local, point.x, point.y);

        return place(solid, inProfile.x, inProfile.y);
    });
}

/** IfcAxis2Placement2D, which has its axis at argument 1 rather than 2. */
function axisPlacement2d(
    file: SpfFile,
    entity: SpfEntity | null,
    scale: number,
): Placement {
    if (!entity) {
        return ORIGIN;
    }

    const point = asNumbers(deref(file, entity.args[0])?.args[0]);
    const reference = asNumbers(deref(file, entity.args[1])?.args[0]);

    return {
        x: (point[0] ?? 0) * scale,
        y: (point[1] ?? 0) * scale,
        z: 0,
        angle:
            reference.length >= 2 ? Math.atan2(reference[1], reference[0]) : 0,
    };
}

function extrusionDepth(extrusion: SpfEntity, scale: number): number {
    return Math.abs((asNumber(extrusion.args[3]) ?? 0) * scale);
}

/* -------------------------------------------------------- the elements */

function wallFrom(
    file: SpfFile,
    entity: SpfEntity,
    scale: number,
    level: string,
    id: string,
): WallElement | null {
    const extrusion = extrusionOf(file, entity);

    if (!extrusion) {
        return null;
    }

    const outline = sweptOutline(file, extrusion, scale);

    if (outline.length < 3) {
        return null;
    }

    const world = placementOf(file, entity, scale);
    const placed = outline.map((point) => place(world, point.x, point.y));
    const box = longestAxis(placed);

    if (!box) {
        return null;
    }

    const height = extrusionDepth(extrusion, scale);

    return {
        id,
        kind: 'wall',
        level,
        typeId: '',
        a: box.a,
        b: box.b,
        height: height > 1 ? height : 2400,
        baseOffset: 0,
        locationLine: 'center',
    };
}

/**
 * The centre line and thickness of a wall's footprint.
 *
 * A wall arrives as its outline, whatever the profile was. The long way
 * through it is the centre line and the short way across is the thickness,
 * which holds for a rectangle and for the ragged polygon Revit writes for a
 * wall that has been joined at both ends.
 */
function longestAxis(
    points: Point[],
): { a: Point; b: Point; thickness: number } | null {
    if (points.length < 3) {
        return null;
    }

    let longest = 0;
    let axis = { x: 1, y: 0 };

    for (let index = 0; index < points.length; index++) {
        const from = points[index];
        const to = points[(index + 1) % points.length];
        const length = Math.hypot(to.x - from.x, to.y - from.y);

        if (length > longest) {
            longest = length;
            axis = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
        }
    }

    if (longest < 1) {
        return null;
    }

    // Measure the outline along its own axis and across it.
    const along = points.map((point) => point.x * axis.x + point.y * axis.y);
    const across = points.map((point) => -point.x * axis.y + point.y * axis.x);

    const minAlong = Math.min(...along);
    const maxAlong = Math.max(...along);
    const midAcross = (Math.min(...across) + Math.max(...across)) / 2;

    const back = (a: number, c: number): Point => ({
        x: a * axis.x - c * axis.y,
        y: a * axis.y + c * axis.x,
    });

    return {
        a: back(minAlong, midAcross),
        b: back(maxAlong, midAcross),
        thickness: Math.max(...across) - Math.min(...across),
    };
}

function floorFrom(
    file: SpfFile,
    entity: SpfEntity,
    scale: number,
    level: string,
    id: string,
): FloorElement | null {
    const extrusion = extrusionOf(file, entity);

    if (!extrusion) {
        return null;
    }

    const outline = sweptOutline(file, extrusion, scale);

    if (outline.length < 3) {
        return null;
    }

    const world = placementOf(file, entity, scale);
    const thickness = extrusionDepth(extrusion, scale);

    return {
        id,
        kind: 'floor',
        level,
        points: outline.map((point) => place(world, point.x, point.y)),
        thickness: thickness > 1 ? thickness : 200,
        offset: 0,
    };
}

function columnFrom(
    file: SpfFile,
    entity: SpfEntity,
    scale: number,
    level: string,
    id: string,
): ColumnElement | null {
    const extrusion = extrusionOf(file, entity);

    if (!extrusion) {
        return null;
    }

    const outline = sweptOutline(file, extrusion, scale);

    if (outline.length < 3) {
        return null;
    }

    const world = placementOf(file, entity, scale);
    const placed = outline.map((point) => place(world, point.x, point.y));

    const xs = placed.map((point) => point.x);
    const ys = placed.map((point) => point.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const depth = Math.max(...ys) - Math.min(...ys);
    const height = extrusionDepth(extrusion, scale);

    return {
        id,
        kind: 'column',
        level,
        p: {
            x: (Math.min(...xs) + Math.max(...xs)) / 2,
            y: (Math.min(...ys) + Math.max(...ys)) / 2,
        },
        size: Math.max(Math.max(width, depth), 1),
        rotation: world.angle,
        height: height > 1 ? height : 3000,
    };
}

function roomFrom(
    file: SpfFile,
    entity: SpfEntity,
    scale: number,
    level: string,
    id: string,
): RoomElement | null {
    const world = placementOf(file, entity, scale);
    const extrusion = extrusionOf(file, entity);

    // A space's tag is where its number lives; the long name is what it is
    // called on a plan.
    const name =
        asString(entity.args[2]) ?? asString(entity.args[7]) ?? 'Space';
    const number = asString(entity.args[4]) ?? '';

    let at: Point = { x: world.x, y: world.y };

    if (extrusion) {
        const outline = sweptOutline(file, extrusion, scale).map((point) =>
            place(world, point.x, point.y),
        );

        if (outline.length >= 3) {
            at = {
                x:
                    outline.reduce((total, point) => total + point.x, 0) /
                    outline.length,
                y:
                    outline.reduce((total, point) => total + point.y, 0) /
                    outline.length,
            };
        }
    }

    return { id, kind: 'room', level, p: at, name, number };
}

/**
 * Anything else, as the triangles it is drawn with.
 *
 * A door, a stair, a piece of furniture: shapes the plan has no native form
 * for, or shapes made in a way this does not read. Bringing them in as a
 * mesh keeps the model whole, which beats a silently missing staircase.
 */
function meshFrom(
    file: SpfFile,
    entity: SpfEntity,
    scale: number,
    level: string,
    id: string,
): MeshElement | null {
    const world = placementOf(file, entity, scale);
    const vertices: number[] = [];

    shapeItems(file, entity).forEach((item) => {
        collectTriangles(file, item, scale, vertices);
    });

    if (vertices.length < 9) {
        return null;
    }

    const plan: Point[] = [];
    let minZ = Infinity;
    let maxX = -Infinity;
    let minX = Infinity;
    let maxY = -Infinity;
    let minY = Infinity;
    let maxZ = -Infinity;

    for (let index = 0; index < vertices.length; index += 3) {
        const x = vertices[index];
        const y = vertices[index + 1];
        const z = vertices[index + 2];

        plan.push({ x, y });
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
    }

    const at = place(world, 0, 0);

    return {
        id,
        kind: 'mesh',
        level,
        name: asString(entity.args[2]) ?? entity.type.replace(/^IFC/, ''),
        p: at,
        rotation: world.angle,
        scale: 1,
        baseOffset: world.z + minZ,
        vertices,
        footprint: convexHull(plan),
        size: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
    };
}

/** Triangles out of whichever way this shape was written. */
function collectTriangles(
    file: SpfFile,
    item: SpfEntity,
    scale: number,
    into: number[],
): void {
    if (item.type === 'IFCFACETEDBREP' || item.type === 'IFCSHELLBASEDSURFACEMODEL') {
        const shells =
            item.type === 'IFCFACETEDBREP'
                ? [deref(file, item.args[0])]
                : derefAll(file, item.args[0]);

        shells.forEach((shell) => {
            if (!shell) {
                return;
            }

            derefAll(file, shell.args[0]).forEach((face) => {
                const loop = derefAll(file, face.args[0])
                    .map((bound) => deref(file, bound.args[0]))
                    .find((found) => found?.type === 'IFCPOLYLOOP');

                if (!loop) {
                    return;
                }

                const polygon = derefAll(file, loop.args[0]).map((point) => {
                    const numbers = asNumbers(point.args[0]);

                    return [
                        (numbers[0] ?? 0) * scale,
                        (numbers[1] ?? 0) * scale,
                        (numbers[2] ?? 0) * scale,
                    ];
                });

                // Fan the face out from its first corner.
                for (let index = 1; index + 1 < polygon.length; index++) {
                    into.push(
                        ...polygon[0],
                        ...polygon[index],
                        ...polygon[index + 1],
                    );
                }
            });
        });

        return;
    }

    if (item.type === 'IFCTRIANGULATEDFACESET' || item.type === 'IFCPOLYGONALFACESET') {
        const coordinates = deref(file, item.args[0]);
        const list = coordinates ? derefAll(file, coordinates.args[0]) : [];

        const points = list.map((point) => {
            const numbers = asNumbers(point.args[0]);

            return [
                (numbers[0] ?? 0) * scale,
                (numbers[1] ?? 0) * scale,
                (numbers[2] ?? 0) * scale,
            ];
        });

        const faces =
            item.type === 'IFCTRIANGULATEDFACESET'
                ? (item.args[4]?.kind === 'list' ? item.args[4].items : [])
                : derefAll(file, item.args[2]).map((face) => face.args[0]);

        faces.forEach((face) => {
            const indices =
                face?.kind === 'list'
                    ? face.items
                          .map(asNumber)
                          .filter((value): value is number => value !== null)
                    : [];

            for (let index = 1; index + 1 < indices.length; index++) {
                // IFC indexes from one.
                const corner = (at: number) => points[indices[at] - 1] ?? [0, 0, 0];

                into.push(...corner(0), ...corner(index), ...corner(index + 1));
            }
        });
    }
}

/* =================================================================== out */

/** What an element is, as IFC would classify it. */
const IFC_TYPES: Record<string, string> = {
    wall: 'IFCWALL',
    floor: 'IFCSLAB',
    roof: 'IFCROOF',
    ceiling: 'IFCCOVERING',
    column: 'IFCCOLUMN',
    beam: 'IFCBEAM',
    brace: 'IFCMEMBER',
    door: 'IFCDOOR',
    window: 'IFCWINDOW',
    stair: 'IFCSTAIR',
    ramp: 'IFCRAMP',
    railing: 'IFCRAILING',
    footing: 'IFCFOOTING',
    pad: 'IFCFOOTING',
    duct: 'IFCDUCTSEGMENT',
    pipe: 'IFCPIPESEGMENT',
    cableTray: 'IFCCABLECARRIERSEGMENT',
    fixture: 'IFCFURNISHINGELEMENT',
};

export type IfcExportOptions = {
    name?: string;
    timestamp?: string;
    author?: string;
};

/**
 * Write the model as IFC4, classified.
 *
 * Every solid goes out as a faceted B-rep under the IFC type its category
 * maps to, so a wall opens in Revit as a wall and not as a lump of geometry
 * called Body. The shapes are the same ones the 3D view draws, which is why
 * what you see is what lands.
 */
export function exportIfc(solids: Solid[], options: IfcExportOptions = {}): string {
    const name = options.name ?? 'model';
    const stamp = options.timestamp ?? '1970-01-01T00:00:00';
    const author = options.author ?? 'Vanhaven';

    const lines: string[] = [];
    let next = 0;

    /** Write one entity and hand back its reference. */
    const put = (body: string): number => {
        const id = ++next;
        lines.push(`#${id}=${body};`);

        return id;
    };

    const ref = (id: number) => `#${id}`;
    const refs = (ids: number[]) => `(${ids.map(ref).join(',')})`;
    const guid = (seed: number) => ifcGuid(seed);
    const real = (value: number) => formatReal(value);

    /* ------------------------------------------------------- the world */

    const person = put(`IFCPERSON($,$,'${escapeIfc(author)}',$,$,$,$,$)`);
    const organisation = put(`IFCORGANIZATION($,'${escapeIfc(author)}',$,$,$)`);
    const owner = put(`IFCPERSONANDORGANIZATION(${ref(person)},${ref(organisation)},$)`);
    const application = put(
        `IFCAPPLICATION(${ref(organisation)},'1.0','${escapeIfc(author)}','${escapeIfc(author)}')`,
    );
    const history = put(
        `IFCOWNERHISTORY(${ref(owner)},${ref(application)},$,.ADDED.,$,$,$,0)`,
    );

    const origin = put('IFCCARTESIANPOINT((0.,0.,0.))');
    const up = put('IFCDIRECTION((0.,0.,1.))');
    const east = put('IFCDIRECTION((1.,0.,0.))');
    const worldPlacement = put(
        `IFCAXIS2PLACEMENT3D(${ref(origin)},${ref(up)},${ref(east)})`,
    );

    // Millimetres, which is what the model is held in, so nothing is scaled
    // on the way out and nothing is lost to rounding.
    const millimetre = put('IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)');
    const squareMetre = put('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)');
    const cubicMetre = put('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)');
    const radian = put('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)');
    const units = put(
        `IFCUNITASSIGNMENT(${refs([millimetre, squareMetre, cubicMetre, radian])})`,
    );

    const context = put(
        `IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,${ref(worldPlacement)},$)`,
    );

    const project = put(
        `IFCPROJECT('${guid(1)}',${ref(history)},'${escapeIfc(name)}',$,$,$,$,${refs([context])},${ref(units)})`,
    );

    const site = put(
        `IFCSITE('${guid(2)}',${ref(history)},'Site',$,$,${ref(placementAt(put, worldPlacement))},$,$,.ELEMENT.,$,$,$,$,$)`,
    );
    const building = put(
        `IFCBUILDING('${guid(3)}',${ref(history)},'Building',$,$,${ref(placementAt(put, worldPlacement))},$,$,.ELEMENT.,$,$,$)`,
    );
    const storey = put(
        `IFCBUILDINGSTOREY('${guid(4)}',${ref(history)},'Level 1',$,$,${ref(placementAt(put, worldPlacement))},$,$,.ELEMENT.,0.)`,
    );

    put(`IFCRELAGGREGATES('${guid(5)}',${ref(history)},$,$,${ref(project)},${refs([site])})`);
    put(`IFCRELAGGREGATES('${guid(6)}',${ref(history)},$,$,${ref(site)},${refs([building])})`);
    put(`IFCRELAGGREGATES('${guid(7)}',${ref(history)},$,$,${ref(building)},${refs([storey])})`);

    /* ------------------------------------------------------ the solids */

    // One point per coordinate, however many faces meet on it.
    const points = new Map<string, number>();
    const pointAt = (vertex: { x: number; y: number; z: number }): number => {
        const key = `${real(vertex.x)},${real(vertex.y)},${real(vertex.z)}`;
        const held = points.get(key);

        if (held !== undefined) {
            return held;
        }

        const id = put(`IFCCARTESIANPOINT((${key}))`);
        points.set(key, id);

        return id;
    };

    const products: number[] = [];

    solids.forEach((solid, index) => {
        const faces = solid.faces
            .filter((face) => face.length >= 3)
            .map((face) => {
                const loop = put(
                    `IFCPOLYLOOP(${refs(face.map(pointAt))})`,
                );
                const bound = put(`IFCFACEOUTERBOUND(${ref(loop)},.T.)`);

                return put(`IFCFACE(${refs([bound])})`);
            });

        if (faces.length === 0) {
            return;
        }

        const shell = put(`IFCCLOSEDSHELL(${refs(faces)})`);
        const brep = put(`IFCFACETEDBREP(${ref(shell)})`);
        const representation = put(
            `IFCSHAPEREPRESENTATION(${ref(context)},'Body','Brep',${refs([brep])})`,
        );
        const shape = put(`IFCPRODUCTDEFINITIONSHAPE($,$,${refs([representation])})`);
        const placement = placementAt(put, worldPlacement);

        const type = IFC_TYPES[solid.category] ?? 'IFCBUILDINGELEMENTPROXY';
        const label = escapeIfc(solid.elementId || `${solid.category}-${index + 1}`);

        // A proxy needs its predefined type; the classified ones do not, and
        // giving them one that IFC4 does not list would fail validation.
        const tail =
            type === 'IFCBUILDINGELEMENTPROXY' ? ',.NOTDEFINED.' : '';

        products.push(
            put(
                `${type}('${guid(100 + index)}',${ref(history)},'${label}',$,$,${ref(placement)},${ref(shape)},$${tail})`,
            ),
        );
    });

    if (products.length > 0) {
        put(
            `IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid(8)}',${ref(history)},$,$,${refs(products)},${ref(storey)})`,
        );
    }

    return [
        'ISO-10303-21;',
        'HEADER;',
        `FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');`,
        `FILE_NAME('${escapeIfc(name)}.ifc','${stamp}',('${escapeIfc(author)}'),('${escapeIfc(author)}'),'${escapeIfc(author)}','${escapeIfc(author)}','');`,
        `FILE_SCHEMA(('IFC4'));`,
        'ENDSEC;',
        'DATA;',
        ...lines,
        'ENDSEC;',
        'END-ISO-10303-21;',
        '',
    ].join('\n');
}

function placementAt(
    put: (body: string) => number,
    axis: number,
): number {
    return put(`IFCLOCALPLACEMENT($,#${axis})`);
}

/**
 * A number the way STEP wants it: always with a decimal point, because
 * `1` is an integer in this grammar and `1.` is a real.
 */
function formatReal(value: number): string {
    if (!Number.isFinite(value)) {
        return '0.';
    }

    const rounded = Math.round(value * 1e6) / 1e6;

    return Number.isInteger(rounded) ? `${rounded}.` : String(rounded);
}

function escapeIfc(value: string): string {
    return value.replace(/'/g, "''").replace(/\\/g, '\\\\');
}

/**
 * An IFC global id: 22 characters of base 64, in IFC's own alphabet.
 *
 * Generated from a counter rather than at random, so exporting the same
 * model twice produces the same file and a diff shows what changed in the
 * building rather than what changed in the identifiers.
 */
function ifcGuid(seed: number): string {
    const ALPHABET =
        '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

    let value = seed;
    let out = '';

    for (let index = 0; index < 22; index++) {
        out = ALPHABET[value % 64] + out;
        value = Math.floor(value / 64) + index * 7;
    }

    return out;
}
