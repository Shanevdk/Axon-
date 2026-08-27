import {
    add,
    distance,
    intersectLines,
    lerp,
    normalize,
    perpendicular,
    pointInPolygon,
    polygonArea,
    projectOnSegment,
    rectCorners,
    rotate,
    scale,
    subtract,
} from '@/lib/cad/geometry';
import type {
    CadDocument,
    CadElement,
    DoorType,
    DuctSystem,
    ElementKind,
    FixtureCategory,
    FixtureElement,
    FloorElement,
    OpeningElement,
    PipeSystem,
    Point,
    RoomElement,
    ToolId,
    WallElement,
    WallType,
    WindowType,
} from '@/lib/cad/types';

let idCounter = 0;

export function createId(prefix: string): string {
    idCounter += 1;

    return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function wallTypeOf(document: CadDocument, typeId: string): WallType {
    return (
        document.wallTypes.find((type) => type.id === typeId) ??
        document.wallTypes[0] ?? {
            id: 'generic-200',
            name: 'Generic - 200mm',
            thickness: 200,
            function: 'interior',
        }
    );
}

export function doorTypeOf(document: CadDocument, typeId: string): DoorType {
    return (
        document.doorTypes.find((type) => type.id === typeId) ??
        document.doorTypes[0] ?? {
            id: 'door-single-915',
            name: 'Single-Flush 915 x 2134',
            width: 915,
            height: 2134,
            leaves: 1,
        }
    );
}

export function windowTypeOf(
    document: CadDocument,
    typeId: string,
): WindowType {
    return (
        document.windowTypes.find((type) => type.id === typeId) ??
        document.windowTypes[0] ?? {
            id: 'win-fixed-900',
            name: 'Fixed 900 x 1200',
            width: 900,
            height: 1200,
            sillHeight: 900,
        }
    );
}

export function openingSize(
    document: CadDocument,
    opening: OpeningElement,
): { width: number; height: number; sillHeight: number } {
    if (opening.kind === 'door') {
        const type = doorTypeOf(document, opening.typeId);

        return {
            width: opening.width ?? type.width,
            height: opening.height ?? type.height,
            sillHeight: 0,
        };
    }

    const type = windowTypeOf(document, opening.typeId);

    return {
        width: opening.width ?? type.width,
        height: opening.height ?? type.height,
        sillHeight: opening.sillHeight ?? type.sillHeight,
    };
}

/**
 * The size the opening's type would give it, ignoring any instance override.
 * The properties palette shows this so you can see what you have departed
 * from, and reset back to it.
 */
export function openingTypeSize(
    document: CadDocument,
    opening: OpeningElement,
): { width: number; height: number; sillHeight: number } {
    if (opening.kind === 'door') {
        const type = doorTypeOf(document, opening.typeId);

        return { width: type.width, height: type.height, sillHeight: 0 };
    }

    const type = windowTypeOf(document, opening.typeId);

    return {
        width: type.width,
        height: type.height,
        sillHeight: type.sillHeight,
    };
}

/**
 * Whether this opening has been resized away from its type.
 */
export function openingIsResized(opening: OpeningElement): boolean {
    return (
        opening.width !== undefined ||
        opening.height !== undefined ||
        (opening.kind === 'window' && opening.sillHeight !== undefined)
    );
}

/** Nothing narrower than this is a door or a window. */
export const MIN_OPENING_WIDTH = 150;

/** Nor anything shorter. */
export const MIN_OPENING_HEIGHT = 150;

/** How much wall has to survive past each jamb. */
export const OPENING_END_MARGIN = 50;

/**
 * The widest an opening may be inside its host: a jamb has to stop short of
 * each end or the wall stops being a wall.
 */
export function maxOpeningWidth(wallLength: number): number {
    return Math.max(MIN_OPENING_WIDTH, wallLength - 2 * OPENING_END_MARGIN);
}

/**
 * Resize an opening, keeping it inside its host and keeping the jamb you were
 * not dragging where it was.
 *
 * `anchor` says which edge holds still: 'a' pins the jamb nearer the wall's
 * start, 'b' the far one, and 'center' grows it evenly about its middle.
 */
export function resizeOpening(
    opening: OpeningElement,
    currentWidth: number,
    wallLength: number,
    requestedWidth: number,
    anchor: 'a' | 'b' | 'center' = 'center',
): OpeningElement {
    const width = Math.min(
        maxOpeningWidth(wallLength),
        Math.max(MIN_OPENING_WIDTH, requestedWidth),
    );

    if (anchor === 'center' || wallLength <= 0) {
        return {
            ...opening,
            width,
            t: clampOpeningParameter(width, wallLength, opening.t),
        };
    }

    // Hold one jamb still by walking the centre half the change the other way.
    const shift = (width - currentWidth) / 2 / wallLength;
    const t = anchor === 'a' ? opening.t + shift : opening.t - shift;

    return {
        ...opening,
        width,
        t: clampOpeningParameter(width, wallLength, t),
    };
}

export type FixturePreset = {
    name: string;
    width: number;
    depth: number;
    height: number;
    /** Height of the underside above the level, in millimetres. */
    elevation: number;
};

/**
 * The stand-in family catalogue: what each component category places until a
 * real type is chosen. Ceiling-hung categories carry their mounting height.
 */
export const FIXTURE_PRESETS: Record<FixtureCategory, FixturePreset> = {
    mechanical: {
        name: 'Air Handling Unit',
        width: 1500,
        depth: 900,
        height: 1400,
        elevation: 0,
    },
    airTerminal: {
        name: 'Supply Diffuser',
        width: 600,
        depth: 600,
        height: 250,
        elevation: 2450,
    },
    lighting: {
        name: 'Luminaire',
        width: 600,
        depth: 600,
        height: 100,
        elevation: 2600,
    },
    electrical: {
        name: 'Panelboard',
        width: 600,
        depth: 150,
        height: 900,
        elevation: 1200,
    },
    plumbing: {
        name: 'Plumbing Fixture',
        width: 700,
        depth: 450,
        height: 400,
        elevation: 0,
    },
    sprinkler: {
        name: 'Sprinkler',
        width: 150,
        depth: 150,
        height: 100,
        elevation: 2600,
    },
    furniture: {
        name: 'Furniture',
        width: 1200,
        depth: 600,
        height: 750,
        elevation: 0,
    },
    planting: {
        name: 'Deciduous Tree',
        width: 3500,
        depth: 3500,
        height: 6000,
        elevation: 0,
    },
    parking: {
        name: 'Parking Stall',
        width: 2600,
        depth: 5500,
        height: 20,
        elevation: 0,
    },
};

export const FIXTURE_CATEGORY_LABELS: Record<FixtureCategory, string> = {
    mechanical: 'Mechanical Equipment',
    airTerminal: 'Air Terminals',
    lighting: 'Lighting Fixtures',
    electrical: 'Electrical Equipment',
    plumbing: 'Plumbing Fixtures',
    sprinkler: 'Sprinklers',
    furniture: 'Furniture',
    planting: 'Planting',
    parking: 'Parking',
};

export const DUCT_SYSTEM_LABELS: Record<DuctSystem, string> = {
    supply: 'Supply Air',
    return: 'Return Air',
    exhaust: 'Exhaust Air',
};

export const PIPE_SYSTEM_LABELS: Record<PipeSystem, string> = {
    domestic: 'Domestic Water',
    sanitary: 'Sanitary',
    hydronic: 'Hydronic',
    fire: 'Fire Protection',
};

export type WallGeometry = {
    wall: WallElement;
    type: WallType;
    thickness: number;
    /** Centre line of the wall body, after applying the location line. */
    a: Point;
    b: Point;
    direction: Point;
    normal: Point;
    length: number;
    /** [aLeft, bLeft, bRight, aRight], mitred into neighbouring walls. */
    polygon: Point[];
};

/**
 * Shift from the drawn location line to the centre of the wall body.
 */
function locationShift(wall: WallElement, thickness: number): number {
    if (wall.locationLine === 'left') {
        return -thickness / 2;
    }

    if (wall.locationLine === 'right') {
        return thickness / 2;
    }

    return 0;
}

function nodeKey(p: Point): string {
    return `${Math.round(p.x / 5)}:${Math.round(p.y / 5)}`;
}

/**
 * Resolve every wall on a level into a mitred footprint.
 *
 * Walls that meet exactly one other wall at an end are joined with a mitre so
 * corners read as a single continuous body; anything else gets a square butt
 * end, which is what Revit falls back to at a three-way junction.
 */
export function buildWallGeometry(
    document: CadDocument,
    walls: WallElement[],
): Map<string, WallGeometry> {
    const bases = walls.map((wall) => {
        const type = wallTypeOf(document, wall.typeId);
        const direction = normalize(subtract(wall.b, wall.a));
        const normal = perpendicular(direction);
        const shift = locationShift(wall, type.thickness);

        return {
            wall,
            type,
            thickness: type.thickness,
            direction,
            normal,
            a: add(wall.a, scale(normal, shift)),
            b: add(wall.b, scale(normal, shift)),
            length: distance(wall.a, wall.b),
        };
    });

    const nodes = new Map<string, { index: number; end: 'a' | 'b' }[]>();

    bases.forEach((base, index) => {
        (['a', 'b'] as const).forEach((end) => {
            const key = nodeKey(base[end]);
            const bucket = nodes.get(key) ?? [];
            bucket.push({ index, end });
            nodes.set(key, bucket);
        });
    });

    const geometry = new Map<string, WallGeometry>();

    bases.forEach((base, index) => {
        const corners = (['a', 'b'] as const).map((end) => {
            const origin = base[end];
            const outward =
                end === 'a' ? base.direction : scale(base.direction, -1);
            const outwardNormal = perpendicular(outward);
            const halfThickness = base.thickness / 2;
            const butt = {
                plus: add(origin, scale(outwardNormal, halfThickness)),
                minus: add(origin, scale(outwardNormal, -halfThickness)),
            };

            const neighbours = (nodes.get(nodeKey(origin)) ?? []).filter(
                (entry) => entry.index !== index,
            );

            if (neighbours.length !== 1) {
                return butt;
            }

            const neighbour = bases[neighbours[0].index];
            const neighbourFar =
                neighbours[0].end === 'a' ? neighbour.b : neighbour.a;
            const incoming = normalize(subtract(origin, neighbourFar));
            const incomingNormal = perpendicular(incoming);
            const neighbourHalf = neighbour.thickness / 2;

            const plus = intersectLines(
                add(origin, scale(incomingNormal, neighbourHalf)),
                incoming,
                add(origin, scale(outwardNormal, halfThickness)),
                outward,
            );
            const minus = intersectLines(
                add(origin, scale(incomingNormal, -neighbourHalf)),
                incoming,
                add(origin, scale(outwardNormal, -halfThickness)),
                outward,
            );

            const limit = 6 * Math.max(base.thickness, neighbour.thickness);

            if (
                !plus ||
                !minus ||
                distance(plus, origin) > limit ||
                distance(minus, origin) > limit
            ) {
                return butt;
            }

            return { plus, minus };
        });

        const [atA, atB] = corners;

        geometry.set(base.wall.id, {
            ...base,
            // At `b` the outward direction is reversed, so `plus` lands on the
            // right-hand face of the wall rather than the left.
            polygon: [atA.plus, atB.minus, atB.plus, atA.minus],
        });
    });

    return geometry;
}

export type OpeningGeometry = {
    opening: OpeningElement;
    host: WallGeometry;
    width: number;
    center: Point;
    jambA: Point;
    jambB: Point;
    direction: Point;
    normal: Point;
    /** Footprint of the void cut through the wall. */
    polygon: Point[];
};

/**
 * Clamp an opening parameter so the leaf never runs past the end of its host.
 */
export function clampOpeningParameter(
    width: number,
    wallLength: number,
    t: number,
): number {
    if (wallLength <= width) {
        return 0.5;
    }

    const margin = width / 2 / wallLength;

    return Math.min(Math.max(t, margin), 1 - margin);
}

export function buildOpeningGeometry(
    document: CadDocument,
    opening: OpeningElement,
    host: WallGeometry,
): OpeningGeometry {
    const { width } = openingSize(document, opening);
    const t = clampOpeningParameter(width, host.length, opening.t);
    const center = lerp(host.a, host.b, t);
    const half = scale(host.direction, width / 2);
    const jambA = subtract(center, half);
    const jambB = add(center, half);
    // Overshoot the wall faces slightly so the void reliably erases the body.
    const reach = scale(host.normal, host.thickness / 2 + 2);

    return {
        opening,
        host,
        width,
        center,
        jambA,
        jambB,
        direction: host.direction,
        normal: host.normal,
        polygon: [
            add(jambA, reach),
            add(jambB, reach),
            subtract(jambB, reach),
            subtract(jambA, reach),
        ],
    };
}

export function elementsOnLevel(
    document: CadDocument,
    level: string,
): CadElement[] {
    return document.elements.filter((element) => element.level === level);
}

export function wallsOnLevel(
    document: CadDocument,
    level: string,
): WallElement[] {
    return document.elements.filter(
        (element): element is WallElement =>
            element.kind === 'wall' && element.level === level,
    );
}

export function findElement(
    document: CadDocument,
    id: string,
): CadElement | undefined {
    return document.elements.find((element) => element.id === id);
}

export function findWall(
    document: CadDocument,
    id: string,
): WallElement | undefined {
    const element = findElement(document, id);

    return element?.kind === 'wall' ? element : undefined;
}

const HIT_PRIORITY: Record<ElementKind, number> = {
    text: 0,
    spotElevation: 0,
    dimension: 1,
    grid: 1,
    referencePlane: 1,
    section: 1,
    revisionCloud: 1,
    propertyLine: 1,
    walkthrough: 1,
    door: 2,
    window: 2,
    column: 3,
    stair: 3,
    ramp: 3,
    footing: 3,
    fixture: 3,
    beam: 4,
    brace: 4,
    railing: 4,
    duct: 4,
    pipe: 4,
    cableTray: 4,
    room: 4,
    wall: 5,
    mesh: 6,
    line: 7,
    floor: 8,
    ceiling: 8,
    pad: 8,
    roof: 9,
    toposurface: 10,
};

/**
 * Find the element under the cursor, preferring annotation and openings over
 * the larger bodies they sit on.
 */
export function hitTest(
    document: CadDocument,
    level: string,
    world: Point,
    tolerance: number,
    geometry: Map<string, WallGeometry>,
    roomBoundaries: Map<string, { polygon: Point[] }>,
): CadElement | null {
    const candidates = elementsOnLevel(document, level).filter((element) =>
        elementContainsPoint(
            document,
            element,
            world,
            tolerance,
            geometry,
            roomBoundaries,
        ),
    );

    if (candidates.length === 0) {
        return null;
    }

    return candidates.sort(
        (a, b) => HIT_PRIORITY[a.kind] - HIT_PRIORITY[b.kind],
    )[0];
}

function elementContainsPoint(
    document: CadDocument,
    element: CadElement,
    world: Point,
    tolerance: number,
    geometry: Map<string, WallGeometry>,
    roomBoundaries: Map<string, { polygon: Point[] }>,
): boolean {
    switch (element.kind) {
        case 'wall': {
            const wall = geometry.get(element.id);

            if (!wall) {
                return false;
            }

            return (
                pointInPolygon(world, wall.polygon) ||
                projectOnSegment(world, wall.a, wall.b).distance <= tolerance
            );
        }
        case 'door':
        case 'window': {
            const host = geometry.get(element.host);

            if (!host) {
                return false;
            }

            return pointInPolygon(
                world,
                buildOpeningGeometry(document, element, host).polygon,
            );
        }
        case 'column': {
            const half = element.size / 2;

            return (
                Math.abs(world.x - element.p.x) <= half &&
                Math.abs(world.y - element.p.y) <= half
            );
        }
        case 'room': {
            const polygon = roomBoundaries.get(element.id)?.polygon;

            if (polygon && polygon.length >= 3) {
                return pointInPolygon(world, polygon);
            }

            return distance(world, element.p) <= tolerance * 4;
        }
        case 'floor':
        case 'ceiling':
            return pointInPolygon(world, element.points);
        case 'roof':
            return pointInPolygon(world, element.points);
        case 'stair':
        case 'ramp':
            return (
                projectOnSegment(world, element.a, element.b).distance <=
                element.width / 2 + tolerance
            );
        case 'beam':
            return (
                projectOnSegment(world, element.a, element.b).distance <=
                element.width / 2 + tolerance
            );
        case 'grid':
        case 'referencePlane':
        case 'section':
            return (
                projectOnSegment(world, element.a, element.b).distance <=
                tolerance
            );
        case 'revisionCloud':
            return (
                pointInPolygon(world, element.points) ||
                element.points.some(
                    (point) => distance(world, point) <= tolerance * 2,
                )
            );
        case 'mesh':
            return pointInPolygon(world, element.footprint);
        case 'dimension':
        case 'line':
        case 'railing':
            return (
                projectOnSegment(world, element.a, element.b).distance <=
                tolerance
            );
        case 'brace':
            return (
                projectOnSegment(world, element.a, element.b).distance <=
                Math.max(element.width / 2, tolerance)
            );
        case 'duct':
        case 'cableTray':
            return (
                projectOnSegment(world, element.a, element.b).distance <=
                element.width / 2 + tolerance
            );
        case 'pipe':
            return (
                projectOnSegment(world, element.a, element.b).distance <=
                Math.max(element.diameter / 2, tolerance)
            );
        case 'footing': {
            const half = element.width / 2;

            return (
                Math.abs(world.x - element.p.x) <= half &&
                Math.abs(world.y - element.p.y) <= half
            );
        }
        case 'fixture': {
            const local = rotate(world, -element.rotation, element.p);

            return (
                Math.abs(local.x - element.p.x) <= element.width / 2 &&
                Math.abs(local.y - element.p.y) <= element.depth / 2
            );
        }
        case 'pad':
        case 'toposurface':
            return pointInPolygon(world, element.points);
        case 'propertyLine':
            // Only the boundary picks, so the site inside stays clickable.
            return element.points.some((point, index) => {
                const next =
                    element.points[(index + 1) % element.points.length];

                return (
                    projectOnSegment(world, point, next).distance <= tolerance
                );
            });
        case 'walkthrough':
            // An open path — no closing edge between the last and first stop.
            return element.points.some((point, index) => {
                const next = element.points[index + 1];

                return (
                    next !== undefined &&
                    projectOnSegment(world, point, next).distance <= tolerance
                );
            });
        case 'text':
        case 'spotElevation':
            return distance(world, element.p) <= tolerance * 4;
        default:
            return false;
    }
}

/* -------------------------------------------------------------------------
 * Document transforms — every helper returns a new document.
 * ---------------------------------------------------------------------- */

export function withElements(
    document: CadDocument,
    elements: CadElement[],
): CadDocument {
    return { ...document, elements: [...document.elements, ...elements] };
}

export function withPatchedElement<T extends CadElement>(
    document: CadDocument,
    id: string,
    patch: Partial<T>,
): CadDocument {
    return {
        ...document,
        elements: document.elements.map((element) =>
            element.id === id
                ? ({ ...element, ...patch } as CadElement)
                : element,
        ),
    };
}

/**
 * Remove elements, taking any openings hosted by a deleted wall with them.
 */
export function withoutElements(
    document: CadDocument,
    ids: string[],
): CadDocument {
    const removed = new Set(ids);

    document.elements.forEach((element) => {
        if (
            (element.kind === 'door' || element.kind === 'window') &&
            removed.has(element.host)
        ) {
            removed.add(element.id);
        }
    });

    return {
        ...document,
        elements: document.elements.filter(
            (element) => !removed.has(element.id),
        ),
    };
}

type TransformFn = (p: Point) => Point;

function transformElement(
    element: CadElement,
    transform: TransformFn,
): CadElement {
    switch (element.kind) {
        case 'wall':
        case 'dimension':
        case 'line':
        case 'stair':
        case 'grid':
        case 'beam':
        case 'ramp':
        case 'referencePlane':
        case 'section':
        case 'railing':
        case 'brace':
        case 'duct':
        case 'pipe':
        case 'cableTray':
            return {
                ...element,
                a: transform(element.a),
                b: transform(element.b),
            };
        case 'column':
        case 'room':
        case 'text':
        case 'mesh':
        case 'footing':
        case 'fixture':
        case 'spotElevation':
            return { ...element, p: transform(element.p) };
        case 'floor':
        case 'ceiling':
        case 'roof':
        case 'revisionCloud':
        case 'pad':
        case 'toposurface':
        case 'propertyLine':
        case 'walkthrough':
            return { ...element, points: element.points.map(transform) };
        default:
            // Openings ride along with the wall that hosts them.
            return element;
    }
}

export function translateElements(
    document: CadDocument,
    ids: string[],
    delta: Point,
): CadDocument {
    const selected = new Set(ids);

    return {
        ...document,
        elements: document.elements.map((element) =>
            selected.has(element.id) && !element.pinned
                ? transformElement(element, (p) => add(p, delta))
                : element,
        ),
    };
}

export function rotateElements(
    document: CadDocument,
    ids: string[],
    origin: Point,
    radians: number,
): CadDocument {
    const selected = new Set(ids);

    return {
        ...document,
        elements: document.elements.map((element) => {
            if (!selected.has(element.id) || element.pinned) {
                return element;
            }

            const rotated = transformElement(element, (p) =>
                rotate(p, radians, origin),
            );

            return rotated.kind === 'column' || rotated.kind === 'fixture'
                ? { ...rotated, rotation: rotated.rotation + radians }
                : rotated;
        }),
    };
}

export function mirrorElements(
    document: CadDocument,
    ids: string[],
    axisStart: Point,
    axisEnd: Point,
): CadDocument {
    const selected = new Set(ids);
    const axis = normalize(subtract(axisEnd, axisStart));
    const reflect: TransformFn = (p) => {
        const relative = subtract(p, axisStart);
        const along = relative.x * axis.x + relative.y * axis.y;
        const projected = scale(axis, along);

        return add(axisStart, subtract(scale(projected, 2), relative));
    };

    return {
        ...document,
        elements: document.elements.map((element) =>
            selected.has(element.id) && !element.pinned
                ? transformElement(element, reflect)
                : element,
        ),
    };
}

/**
 * Copy elements by `delta`, bringing hosted openings across with their walls.
 */
export function copyElements(
    document: CadDocument,
    ids: string[],
    delta: Point,
): { document: CadDocument; ids: string[] } {
    const selected = new Set(ids);
    const remap = new Map<string, string>();
    const copies: CadElement[] = [];

    document.elements.forEach((element) => {
        if (!selected.has(element.id)) {
            return;
        }

        const id = createId(element.kind);
        remap.set(element.id, id);
        // The copy of a pinned element is an ordinary element — the pin
        // belongs to the original. The mark IS copied, exactly as Revit does
        // it, which is where duplicate-mark warnings come from.
        copies.push({
            ...transformElement(element, (p) => add(p, delta)),
            id,
            pinned: undefined,
        });
    });

    document.elements.forEach((element) => {
        if (
            (element.kind !== 'door' && element.kind !== 'window') ||
            selected.has(element.id)
        ) {
            return;
        }

        const host = remap.get(element.host);

        if (host) {
            const id = createId(element.kind);
            remap.set(element.id, id);
            copies.push({ ...element, id, host });
        }
    });

    const rehosted = copies.map((element) =>
        element.kind === 'door' || element.kind === 'window'
            ? { ...element, host: remap.get(element.host) ?? element.host }
            : element,
    );

    return {
        document: withElements(document, rehosted),
        ids: rehosted.map((element) => element.id),
    };
}

export function nextRoomNumber(document: CadDocument, level: string): string {
    const levelIndex = Math.max(
        document.levels.findIndex((item) => item.id === level),
        0,
    );
    const used = document.elements
        .filter((element): element is RoomElement => element.kind === 'room')
        .map((element) => Number.parseInt(element.number, 10))
        .filter((value) => Number.isFinite(value));

    const base = (levelIndex + 1) * 100;
    const highest = used
        .filter((value) => value >= base && value < base + 100)
        .sort((a, b) => b - a)[0];

    return String(highest ? highest + 1 : base + 1);
}

export function elementDisplayName(
    document: CadDocument,
    element: CadElement,
): string {
    switch (element.kind) {
        case 'wall':
            return wallTypeOf(document, element.typeId).name;
        case 'door':
            return doorTypeOf(document, element.typeId).name;
        case 'window':
            return windowTypeOf(document, element.typeId).name;
        case 'room':
            return `${element.name} ${element.number}`;
        case 'column':
            return `Column ${element.size}mm`;
        case 'floor':
            return `Floor - ${element.thickness}mm`;
        case 'dimension':
            return 'Aligned Dimension';
        case 'text':
            return 'Text Note';
        case 'line':
            return 'Detail Line';
        case 'roof':
            return `Roof - ${element.slope}° pitch`;
        case 'ceiling':
            return 'Compound Ceiling';
        case 'stair':
            return 'Stair Run';
        case 'grid':
            return `Grid ${element.label}`;
        case 'referencePlane':
            return element.name || 'Reference Plane';
        case 'ramp':
            return 'Ramp';
        case 'revisionCloud':
            return `Revision ${element.revision}`;
        case 'section':
            return element.name || 'Section';
        case 'beam':
            return `Beam ${element.width} x ${element.depth}`;
        case 'mesh':
            return element.name;
        case 'railing':
            return `Railing ${element.height}mm`;
        case 'brace':
            return `Brace ${element.width}mm`;
        case 'footing':
            return `Pad Footing ${element.width}mm`;
        case 'duct':
            return `${DUCT_SYSTEM_LABELS[element.system]} Duct ${element.width}mm`;
        case 'pipe':
            return `${PIPE_SYSTEM_LABELS[element.system]} Pipe Ø${element.diameter}`;
        case 'cableTray':
            return `Cable Tray ${element.width}mm`;
        case 'fixture':
            return element.name;
        case 'pad':
            return `Building Pad - ${element.thickness}mm`;
        case 'toposurface':
            return 'Toposurface';
        case 'propertyLine':
            return 'Property Line';
        case 'spotElevation':
            return 'Spot Elevation';
        case 'walkthrough':
            return `Walkthrough (${element.points.length} stops)`;
    }
}

export function elementCategory(kind: ElementKind): string {
    const labels: Record<ElementKind, string> = {
        wall: 'Walls',
        door: 'Doors',
        window: 'Windows',
        column: 'Structural Columns',
        floor: 'Floors',
        room: 'Rooms',
        dimension: 'Dimensions',
        text: 'Text Notes',
        line: 'Lines',
        roof: 'Roofs',
        ceiling: 'Ceilings',
        stair: 'Stairs',
        grid: 'Grids',
        beam: 'Structural Framing',
        referencePlane: 'Reference Planes',
        ramp: 'Ramps',
        revisionCloud: 'Revision Clouds',
        section: 'Sections',
        mesh: 'Imported Geometry',
        railing: 'Railings',
        brace: 'Structural Braces',
        footing: 'Structural Foundations',
        duct: 'Ducts',
        pipe: 'Pipes',
        cableTray: 'Cable Trays',
        fixture: 'Components',
        pad: 'Pads',
        toposurface: 'Topography',
        propertyLine: 'Property Lines',
        spotElevation: 'Spot Elevations',
        walkthrough: 'Walkthroughs',
    };

    return labels[kind];
}

/** Footprint of a placed component, shared by drawing, picking and solids. */
export function fixtureFootprint(fixture: FixtureElement): Point[] {
    return rectCorners(
        fixture.p,
        fixture.width,
        fixture.depth,
        fixture.rotation,
    );
}

/** Total length of every wall on a level, used by the status readouts. */
export function totalWallLength(document: CadDocument, level: string): number {
    return wallsOnLevel(document, level).reduce(
        (total, wall) => total + distance(wall.a, wall.b),
        0,
    );
}

export function floorArea(document: CadDocument, level: string): number {
    return document.elements
        .filter(
            (element): element is FloorElement =>
                element.kind === 'floor' && element.level === level,
        )
        .reduce((total, element) => total + polygonArea(element.points), 0);
}

export type WallLayers = {
    /** Thickness of the finish layer on each face, zero when unlayered. */
    finish: number;
    /** Thickness of the structural core between the two finish layers. */
    core: number;
};

/**
 * Split a wall type into the compound structure Revit reveals at Medium and
 * Fine detail.
 *
 * The layers are derived from the type rather than stored, so an existing
 * document keeps working: exterior types read as a clad core, interior types
 * as a lined core, and anything too thin to line stays a single body.
 */
export function wallLayers(type: WallType): WallLayers {
    const finish =
        type.function === 'exterior'
            ? Math.min(Math.max(type.thickness * 0.12, 12), 30)
            : type.thickness >= 100
              ? Math.min(Math.max(type.thickness * 0.1, 6), 16)
              : 0;

    const core = type.thickness - finish * 2;

    return core <= 0 ? { finish: 0, core: type.thickness } : { finish, core };
}

/**
 * Every element under the cursor, best candidate first.
 *
 * Tab cycles through this list the way Revit does when elements overlap, so
 * a door can be reached without moving off the wall hosting it.
 */
export function hitTestCandidates(
    document: CadDocument,
    level: string,
    world: Point,
    tolerance: number,
    geometry: Map<string, WallGeometry>,
    roomBoundaries: Map<string, { polygon: Point[] }>,
): CadElement[] {
    return elementsOnLevel(document, level)
        .filter((element) =>
            elementContainsPoint(
                document,
                element,
                world,
                tolerance,
                geometry,
                roomBoundaries,
            ),
        )
        .sort((a, b) => HIT_PRIORITY[a.kind] - HIT_PRIORITY[b.kind]);
}

/* ------------------------------------------------------------ housekeeping */

/**
 * Pin or release elements. A pinned element stays put: move, rotate, mirror
 * and its grips all refuse it, and Delete leaves it behind.
 */
export function withPinned(
    document: CadDocument,
    ids: string[],
    pinned: boolean,
): CadDocument {
    const chosen = new Set(ids);

    return {
        ...document,
        elements: document.elements.map((element) =>
            chosen.has(element.id)
                ? { ...element, pinned: pinned || undefined }
                : element,
        ),
    };
}

/**
 * Revit's Match Type Properties, applied across a selection: the first
 * element is the source, and every other selected element of the same kind
 * takes its type.
 *
 * Openings also give up any instance size, because taking a type means
 * taking its size — the same rule the properties palette applies.
 */
export function withMatchedTypes(
    document: CadDocument,
    selection: string[],
): { document: CadDocument; changed: number } {
    const [sourceId, ...targetIds] = selection;
    const source = document.elements.find((item) => item.id === sourceId);

    if (!source || !('typeId' in source) || targetIds.length === 0) {
        return { document, changed: 0 };
    }

    const targets = new Set(targetIds);
    let changed = 0;

    const elements = document.elements.map((element): CadElement => {
        if (
            !targets.has(element.id) ||
            element.kind !== source.kind ||
            !('typeId' in element) ||
            element.typeId === source.typeId
        ) {
            return element;
        }

        changed += 1;

        if (element.kind === 'door' || element.kind === 'window') {
            return {
                ...element,
                typeId: source.typeId,
                width: undefined,
                height: undefined,
                ...(element.kind === 'window' ? { sillHeight: undefined } : {}),
            };
        }

        return { ...element, typeId: source.typeId } as CadElement;
    });

    return { document: { ...document, elements }, changed };
}

/**
 * The drawing tool that places more elements like this one — Revit's Create
 * Similar. Null for the kinds nothing places directly, such as an imported
 * mesh.
 */
export function toolForKind(kind: ElementKind): ToolId | null {
    switch (kind) {
        case 'wall':
        case 'door':
        case 'window':
        case 'column':
        case 'floor':
        case 'room':
        case 'dimension':
        case 'text':
        case 'line':
        case 'roof':
        case 'ceiling':
        case 'stair':
        case 'grid':
        case 'beam':
        case 'referencePlane':
        case 'ramp':
        case 'revisionCloud':
        case 'section':
        case 'railing':
        case 'brace':
        case 'footing':
        case 'duct':
        case 'pipe':
        case 'cableTray':
        case 'fixture':
        case 'pad':
        case 'toposurface':
        case 'propertyLine':
        case 'spotElevation':
        case 'walkthrough':
            return kind;
        default:
            return null;
    }
}
