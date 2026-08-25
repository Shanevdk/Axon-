import { distance } from '@/lib/cad/geometry';
import {
    buildOpeningGeometry,
    buildWallGeometry,
    wallsOnLevel,
} from '@/lib/cad/model';
import { computeRoomBoundaries } from '@/lib/cad/rooms';
import type {
    CadDocument,
    DimensionElement,
    FloorElement,
    LineElement,
    MeshElement,
    OpeningElement,
    Point,
    RoomElement,
} from '@/lib/cad/types';
import { formatArea, formatDimension } from '@/lib/cad/units';

/** AutoCAD colour indices, chosen to plot sensibly on a white sheet. */
const LAYERS: { name: string; colour: number }[] = [
    { name: 'AX-WALL-EXTERIOR', colour: 7 },
    { name: 'AX-WALL-INTERIOR', colour: 8 },
    { name: 'AX-OPENING', colour: 4 },
    { name: 'AX-FLOOR', colour: 9 },
    { name: 'AX-ROOM', colour: 30 },
    { name: 'AX-DIMENSION', colour: 5 },
    { name: 'AX-TEXT', colour: 7 },
    { name: 'AX-IMPORT', colour: 30 },
];

/** DXF `$INSUNITS` values, used on the way in and out. */
const INSUNITS_MILLIMETRES = 4;

const UNIT_SCALE_TO_MM: Record<number, number> = {
    0: 1,
    1: 25.4,
    2: 304.8,
    4: 1,
    5: 10,
    6: 1000,
    8: 0.0254,
    9: 0.0254,
    10: 914.4,
};

/**
 * Write the plan of one level as a DXF drawing.
 *
 * Geometry goes out as closed polylines on named layers so a consultant can
 * pick up the walls, rooms and annotation separately in AutoCAD.
 */
export function exportDxf(document: CadDocument, levelId: string): string {
    const level =
        document.levels.find((item) => item.id === levelId) ??
        document.levels[0];
    const walls = [
        ...buildWallGeometry(
            document,
            wallsOnLevel(document, level.id),
        ).values(),
    ];
    const body: string[] = [];

    document.elements
        .filter(
            (element): element is FloorElement =>
                element.kind === 'floor' && element.level === level.id,
        )
        .forEach((floor) =>
            body.push(...polyline(floor.points, 'AX-FLOOR', true)),
        );

    walls.forEach((wall) => {
        body.push(
            ...polyline(
                wall.polygon,
                wall.type.function === 'exterior'
                    ? 'AX-WALL-EXTERIOR'
                    : 'AX-WALL-INTERIOR',
                true,
            ),
        );
    });

    document.elements
        .filter(
            (element): element is OpeningElement =>
                (element.kind === 'door' || element.kind === 'window') &&
                element.level === level.id,
        )
        .forEach((opening) => {
            const host = walls.find((wall) => wall.wall.id === opening.host);

            if (!host) {
                return;
            }

            body.push(
                ...polyline(
                    buildOpeningGeometry(document, opening, host).polygon,
                    'AX-OPENING',
                    true,
                ),
            );
        });

    const tags = document.elements.filter(
        (element): element is RoomElement =>
            element.kind === 'room' && element.level === level.id,
    );
    const boundaries = computeRoomBoundaries(tags, walls);

    tags.forEach((room) => {
        const boundary = boundaries.get(room.id);

        if (boundary) {
            body.push(...polyline(boundary.polygon, 'AX-ROOM', true));
        }

        body.push(
            ...text(room.p, `${room.name} ${room.number}`, 'AX-TEXT', 300),
            ...text(
                { x: room.p.x, y: room.p.y - 400 },
                boundary
                    ? formatArea(boundary.area, document.units)
                    : 'Not Enclosed',
                'AX-TEXT',
                200,
            ),
        );
    });

    document.elements
        .filter(
            (element): element is LineElement =>
                element.kind === 'line' && element.level === level.id,
        )
        .forEach((element) =>
            body.push(...line(element.a, element.b, 'AX-TEXT')),
        );

    document.elements
        .filter(
            (element): element is DimensionElement =>
                element.kind === 'dimension' && element.level === level.id,
        )
        .forEach((element) => {
            body.push(
                ...line(element.a, element.b, 'AX-DIMENSION'),
                ...text(
                    {
                        x: (element.a.x + element.b.x) / 2,
                        y: (element.a.y + element.b.y) / 2,
                    },
                    formatDimension(
                        distance(element.a, element.b),
                        document.units,
                    ),
                    'AX-DIMENSION',
                    200,
                ),
            );
        });

    document.elements
        .filter(
            (element): element is MeshElement =>
                element.kind === 'mesh' && element.level === level.id,
        )
        .forEach((mesh) => {
            if (mesh.footprint.length >= 3) {
                body.push(
                    ...polyline(
                        mesh.footprint.map((corner) => ({
                            x: mesh.p.x + corner.x * mesh.scale,
                            y: mesh.p.y + corner.y * mesh.scale,
                        })),
                        'AX-IMPORT',
                        true,
                    ),
                );
            }
        });

    return [...prologue(), ...body, ...epilogue()].join('\r\n');
}

function prologue(): string[] {
    const lines = [
        '999',
        'Axon',
        '0',
        'SECTION',
        '2',
        'HEADER',
        '9',
        '$ACADVER',
        '1',
        'AC1015',
        '9',
        '$INSUNITS',
        '70',
        String(INSUNITS_MILLIMETRES),
        '0',
        'ENDSEC',
        '0',
        'SECTION',
        '2',
        'TABLES',
        '0',
        'TABLE',
        '2',
        'LAYER',
        '70',
        String(LAYERS.length),
    ];

    LAYERS.forEach((layer) => {
        lines.push(
            '0',
            'LAYER',
            '2',
            layer.name,
            '70',
            '0',
            '62',
            String(layer.colour),
            '6',
            'CONTINUOUS',
        );
    });

    lines.push('0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES');

    return lines;
}

function epilogue(): string[] {
    return ['0', 'ENDSEC', '0', 'EOF', ''];
}

function polyline(points: Point[], layer: string, closed: boolean): string[] {
    if (points.length < 2) {
        return [];
    }

    const lines = [
        '0',
        'LWPOLYLINE',
        '8',
        layer,
        '90',
        String(points.length),
        '70',
        closed ? '1' : '0',
    ];

    points.forEach((point) => {
        lines.push('10', real(point.x), '20', real(point.y));
    });

    return lines;
}

function line(a: Point, b: Point, layer: string): string[] {
    return [
        '0',
        'LINE',
        '8',
        layer,
        '10',
        real(a.x),
        '20',
        real(a.y),
        '30',
        '0.0',
        '11',
        real(b.x),
        '21',
        real(b.y),
        '31',
        '0.0',
    ];
}

function text(
    position: Point,
    value: string,
    layer: string,
    height: number,
): string[] {
    return [
        '0',
        'TEXT',
        '8',
        layer,
        '10',
        real(position.x),
        '20',
        real(position.y),
        '30',
        '0.0',
        '40',
        real(height),
        '1',
        value,
        '72',
        '1',
        '11',
        real(position.x),
        '21',
        real(position.y),
        '31',
        '0.0',
    ];
}

function real(value: number): string {
    return value.toFixed(4);
}

/* ------------------------------------------------------------------ import */

export type DxfPolyline = {
    points: Point[];
    closed: boolean;
    layer: string;
};

export type DxfDrawing = {
    polylines: DxfPolyline[];
    /** Scale that was applied to reach millimetres, from `$INSUNITS`. */
    unitScale: number;
    layers: string[];
};

type Pair = { code: number; value: string };

/**
 * Read LINE, LWPOLYLINE and POLYLINE geometry out of an ASCII DXF.
 *
 * Blocks, arcs, splines and text are skipped — this is aimed at picking up a
 * survey or a consultant's setting-out lines, not at being a DXF viewer.
 */
export function parseDxf(source: string): DxfDrawing {
    const pairs = readPairs(source);
    const unitScale = readUnitScale(pairs);
    const polylines: DxfPolyline[] = [];
    const layers = new Set<string>();

    let index = entitiesStart(pairs);

    while (index < pairs.length) {
        const pair = pairs[index];

        if (pair.code === 0 && pair.value === 'ENDSEC') {
            break;
        }

        if (pair.code !== 0) {
            index += 1;

            continue;
        }

        const type = pair.value;
        const next = nextEntity(pairs, index + 1);
        const body = pairs.slice(index + 1, next);

        if (type === 'LINE') {
            const a = { x: numberOf(body, 10), y: numberOf(body, 20) };
            const b = { x: numberOf(body, 11), y: numberOf(body, 21) };

            if (Number.isFinite(a.x) && Number.isFinite(b.x)) {
                polylines.push({
                    points: [
                        scalePoint(a, unitScale),
                        scalePoint(b, unitScale),
                    ],
                    closed: false,
                    layer: layerOf(body),
                });
            }
        }

        if (type === 'LWPOLYLINE') {
            const points = collectPoints(body, unitScale);

            if (points.length >= 2) {
                polylines.push({
                    points,
                    closed: (numberOf(body, 70) & 1) === 1,
                    layer: layerOf(body),
                });
            }
        }

        if (type === 'POLYLINE') {
            const closed = (numberOf(body, 70) & 1) === 1;
            const layer = layerOf(body);
            const points: Point[] = [];
            let cursor = next;

            while (cursor < pairs.length) {
                const marker = pairs[cursor];

                if (marker.code !== 0) {
                    cursor += 1;

                    continue;
                }

                if (marker.value === 'SEQEND' || marker.value === 'ENDSEC') {
                    break;
                }

                if (marker.value !== 'VERTEX') {
                    break;
                }

                const vertexEnd = nextEntity(pairs, cursor + 1);
                const vertex = pairs.slice(cursor + 1, vertexEnd);

                points.push(
                    scalePoint(
                        { x: numberOf(vertex, 10), y: numberOf(vertex, 20) },
                        unitScale,
                    ),
                );
                cursor = vertexEnd;
            }

            if (points.length >= 2) {
                polylines.push({ points, closed, layer });
            }

            index = cursor;

            continue;
        }

        index = next;
    }

    polylines.forEach((item) => layers.add(item.layer));

    return { polylines, unitScale, layers: [...layers].sort() };
}

function readPairs(source: string): Pair[] {
    const lines = source.split(/\r\n|\r|\n/);
    const pairs: Pair[] = [];

    for (let index = 0; index + 1 < lines.length; index += 2) {
        const code = Number.parseInt(lines[index].trim(), 10);

        if (Number.isFinite(code)) {
            pairs.push({ code, value: lines[index + 1].trim() });
        }
    }

    return pairs;
}

function readUnitScale(pairs: Pair[]): number {
    const marker = pairs.findIndex(
        (pair) => pair.code === 9 && pair.value === '$INSUNITS',
    );

    if (marker === -1) {
        return 1;
    }

    const value = pairs
        .slice(marker + 1, marker + 3)
        .find((pair) => pair.code === 70);

    return UNIT_SCALE_TO_MM[Number.parseInt(value?.value ?? '4', 10)] ?? 1;
}

function entitiesStart(pairs: Pair[]): number {
    const marker = pairs.findIndex(
        (pair) => pair.code === 2 && pair.value === 'ENTITIES',
    );

    return marker === -1 ? 0 : marker + 1;
}

function nextEntity(pairs: Pair[], from: number): number {
    for (let index = from; index < pairs.length; index++) {
        if (pairs[index].code === 0) {
            return index;
        }
    }

    return pairs.length;
}

function numberOf(body: Pair[], code: number): number {
    const pair = body.find((item) => item.code === code);

    return pair ? Number.parseFloat(pair.value) : Number.NaN;
}

function layerOf(body: Pair[]): string {
    return body.find((item) => item.code === 8)?.value ?? '0';
}

function collectPoints(body: Pair[], scale: number): Point[] {
    const points: Point[] = [];
    let pending: number | null = null;

    body.forEach((pair) => {
        if (pair.code === 10) {
            pending = Number.parseFloat(pair.value);
        }

        if (pair.code === 20 && pending !== null) {
            points.push(
                scalePoint(
                    { x: pending, y: Number.parseFloat(pair.value) },
                    scale,
                ),
            );
            pending = null;
        }
    });

    return points;
}

function scalePoint(point: Point, scale: number): Point {
    return { x: point.x * scale, y: point.y * scale };
}
