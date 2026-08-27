/**
 * Reads the model the way a code consultant would look at a set of drawings.
 *
 * Where `brief.ts` describes what a photograph of the building would show,
 * this measures the things a building or fire code cares about: how many
 * storeys, how far it is to a door, how wide the stairs are, how much glass
 * each room has. The result is handed to the assistant as plain text, so it
 * is worded for reading rather than parsing.
 *
 * Every length in the document is millimetres. The survey speaks in metres
 * and square metres, and says so, because that is what codes are written in.
 */

import { distance, polygonArea } from '@/lib/cad/geometry';
import {
    buildWallGeometry,
    openingSize,
    wallsOnLevel,
    wallTypeOf,
} from '@/lib/cad/model';
import { computeRoomBoundaries } from '@/lib/cad/rooms';
import type {
    CadDocument,
    DoorElement,
    FloorElement,
    Level,
    RoofElement,
    RoomElement,
    StairElement,
    WallElement,
    WindowElement,
} from '@/lib/cad/types';

/**
 * Above this many room tags the per-room areas are left out. Each level's
 * rooms are found by flood fill, and a chat window is not the place to spend
 * a second on it.
 */
const ROOMS_WORTH_MEASURING = 60;

export type BuildingSurvey = {
    /** Short lines shown beside the conversation, already worded for a person. */
    facts: string[];
    /** The block handed to the assistant. */
    brief: string;
    /** True when there is not enough drawn to say anything. */
    empty: boolean;
};

/**
 * Measure the model.
 */
export function surveyBuilding(document: CadDocument): BuildingSurvey {
    const walls = live<WallElement>(document, 'wall');
    const floors = live<FloorElement>(document, 'floor');
    const roofs = live<RoofElement>(document, 'roof');
    const doors = live<DoorElement>(document, 'door');
    const windows = live<WindowElement>(document, 'window');
    const stairs = live<StairElement>(document, 'stair');
    const rooms = live<RoomElement>(document, 'room');

    if (walls.length === 0 && floors.length === 0) {
        return { facts: [], brief: '', empty: true };
    }

    const lines: string[] = [];
    const facts: string[] = [];

    const storeys = occupiedLevels(document, walls, floors);

    lines.push(
        `Storeys: ${storeys.length} (${storeys
            .map((level) => `${level.name} at ${metres(level.elevation)} m`)
            .join(', ')})`,
    );
    facts.push(
        storeys.length === 1 ? 'Single storey' : `${storeys.length} storeys`,
    );

    const height = overallHeight(document, walls);

    if (height > 0) {
        lines.push(`Height above the lowest level: ${metres(height)} m`);
        facts.push(`${metres(height)} m tall`);
    }

    const extent = footprint([
        ...walls.flatMap((wall) => [wall.a, wall.b]),
        ...floors.flatMap((floor) => floor.points),
        ...roofs.flatMap((roof) => roof.points),
    ]);

    if (extent) {
        lines.push(
            `Footprint: about ${metres(extent.width)} by ${metres(extent.depth)} m`,
        );
    }

    const floorArea = floors.reduce(
        (total, floor) => total + polygonArea(floor.points),
        0,
    );

    if (floorArea > 0) {
        lines.push(`Gross floor area drawn: ${squareMetres(floorArea)} m²`);
        facts.push(`${squareMetres(floorArea)} m² of floor`);
    }

    const roomLines = describeRooms(document, rooms);

    if (roomLines) {
        lines.push(roomLines);
    }

    if (rooms.length > 0) {
        facts.push(`${rooms.length} room${rooms.length === 1 ? '' : 's'}`);
    }

    lines.push(...describeDoors(document, doors, walls));
    lines.push(...describeStairs(stairs));
    lines.push(...describeWindows(document, windows, walls));
    lines.push(describeWallTypes(document, walls));

    if (doors.length > 0) {
        facts.push(`${doors.length} door${doors.length === 1 ? '' : 's'}`);
    }

    if (stairs.length > 0) {
        facts.push(`${stairs.length} stair${stairs.length === 1 ? '' : 's'}`);
    }

    if (windows.length > 0) {
        facts.push(
            `${windows.length} window${windows.length === 1 ? '' : 's'}`,
        );
    }

    return {
        facts,
        brief: lines.filter((line) => line !== '').join('\n'),
        empty: false,
    };
}

/* ---------------------------------------------------------------- storeys */

/**
 * The levels that are actually built on, rather than every level the project
 * happens to define, ordered from the bottom up.
 */
function occupiedLevels(
    document: CadDocument,
    walls: WallElement[],
    floors: FloorElement[],
): Level[] {
    const used = new Set([
        ...walls.map((wall) => wall.level),
        ...floors.map((floor) => floor.level),
    ]);

    const levels = document.levels
        .filter((level) => used.has(level.id))
        .sort((a, b) => a.elevation - b.elevation);

    return levels.length > 0 ? levels : document.levels.slice(0, 1);
}

function overallHeight(document: CadDocument, walls: WallElement[]): number {
    const elevations = new Map(
        document.levels.map((level) => [level.id, level.elevation]),
    );
    const base = Math.min(
        0,
        ...document.levels.map((level) => level.elevation),
    );

    return walls.reduce((tallest, wall) => {
        const top =
            (elevations.get(wall.level) ?? 0) +
            (wall.baseOffset ?? 0) +
            wall.height -
            base;

        return Math.max(tallest, top);
    }, 0);
}

/* ------------------------------------------------------------------ rooms */

/**
 * Room names with their enclosed areas, which is what occupant load and
 * egress questions are actually asked about.
 */
function describeRooms(
    document: CadDocument,
    rooms: RoomElement[],
): string | null {
    if (rooms.length === 0) {
        return null;
    }

    if (rooms.length > ROOMS_WORTH_MEASURING) {
        return `Rooms: ${rooms.length} tagged (too many to measure individually here)`;
    }

    const measured: string[] = [];

    for (const level of document.levels) {
        const onLevel = rooms.filter((room) => room.level === level.id);

        if (onLevel.length === 0) {
            continue;
        }

        const boundaries = computeRoomBoundaries(onLevel, [
            ...buildWallGeometry(
                document,
                wallsOnLevel(document, level.id),
            ).values(),
        ]);

        for (const room of onLevel) {
            const area = boundaries.get(room.id)?.area;
            const name = room.name || 'Unnamed';

            measured.push(
                area && area > 0
                    ? `${name} ${squareMetres(area)} m²`
                    : `${name} (not enclosed)`,
            );
        }
    }

    return measured.length > 0
        ? `Rooms (${rooms.length}): ${measured.join(', ')}`
        : `Rooms: ${rooms.length} tagged`;
}

/* ------------------------------------------------------------------ doors */

/**
 * Doors, split by whether they lead outside — the closest the model gets to
 * naming an exit.
 */
function describeDoors(
    document: CadDocument,
    doors: DoorElement[],
    walls: WallElement[],
): string[] {
    if (doors.length === 0) {
        return ['Doors: none drawn'];
    }

    const exterior = new Set(
        walls
            .filter(
                (wall) =>
                    wallTypeOf(document, wall.typeId).function !== 'interior',
            )
            .map((wall) => wall.id),
    );

    const outside = doors.filter((door) => exterior.has(door.host));
    const widths = doors.map((door) => openingSize(document, door).width);

    return [
        `Doors: ${doors.length} in all, ${outside.length} of them in exterior walls`,
        `Door widths: ${Math.round(Math.min(...widths))} to ${Math.round(Math.max(...widths))} mm`,
    ];
}

/* ----------------------------------------------------------------- stairs */

function describeStairs(stairs: StairElement[]): string[] {
    if (stairs.length === 0) {
        return ['Stairs: none drawn'];
    }

    return [
        `Stairs: ${stairs.length}, ${stairs
            .map(
                (stair) =>
                    `${Math.round(stair.width)} mm wide rising ${Math.round(stair.rise)} mm over ${metres(distance(stair.a, stair.b))} m`,
            )
            .join('; ')}`,
    ];
}

/* ---------------------------------------------------------------- windows */

/**
 * Glazed area against exterior wall area, which is the number light and
 * ventilation requirements are written against.
 */
function describeWindows(
    document: CadDocument,
    windows: WindowElement[],
    walls: WallElement[],
): string[] {
    if (windows.length === 0) {
        return ['Windows: none drawn'];
    }

    const glass = windows.reduce((total, opening) => {
        const size = openingSize(document, opening);

        return total + size.width * size.height;
    }, 0);

    const wallArea = walls
        .filter(
            (wall) => wallTypeOf(document, wall.typeId).function !== 'interior',
        )
        .reduce(
            (total, wall) => total + distance(wall.a, wall.b) * wall.height,
            0,
        );

    const ratio = wallArea > 0 ? Math.round((glass / wallArea) * 100) : null;
    const sills = windows.map(
        (opening) => openingSize(document, opening).sillHeight,
    );

    return [
        `Windows: ${windows.length}, ${squareMetres(glass)} m² of glazing${
            ratio === null ? '' : ` (${ratio}% of exterior wall area)`
        }`,
        `Sill heights: ${Math.round(Math.min(...sills))} to ${Math.round(Math.max(...sills))} mm above the level`,
    ];
}

/* ------------------------------------------------------------- wall types */

function describeWallTypes(
    document: CadDocument,
    walls: WallElement[],
): string {
    const seen = new Map<
        string,
        { name: string; use: string; thickness: number }
    >();

    for (const wall of walls) {
        const type = wallTypeOf(document, wall.typeId);

        seen.set(type.id, {
            name: type.name,
            use: type.function,
            thickness: type.thickness,
        });
    }

    if (seen.size === 0) {
        return '';
    }

    return `Wall types in use: ${[...seen.values()]
        .map(
            (type) =>
                `${type.name} (${type.use}, ${Math.round(type.thickness)} mm)`,
        )
        .join(', ')}`;
}

/* ---------------------------------------------------------------- helpers */

/** Elements of a kind that are actually being built — demolished ones are not. */
function live<T>(document: CadDocument, kind: string): T[] {
    return document.elements.filter(
        (element) =>
            element.kind === kind && (element.phase ?? 'new') !== 'demolished',
    ) as T[];
}

function footprint(
    points: { x: number; y: number }[],
): { width: number; depth: number } | null {
    if (points.length === 0) {
        return null;
    }

    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const depth = Math.max(...ys) - Math.min(...ys);

    return width > 0 && depth > 0 ? { width, depth } : null;
}

function metres(millimetres: number): string {
    return (millimetres / 1000).toFixed(1);
}

function squareMetres(squareMillimetres: number): string {
    return Math.round(squareMillimetres / 1_000_000).toLocaleString('en-CA');
}
