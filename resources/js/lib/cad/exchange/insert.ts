import type { DxfPolyline } from '@/lib/cad/exchange/dxf';
import type { ImportedMesh } from '@/lib/cad/exchange/mesh-import';
import { distance } from '@/lib/cad/geometry';
import { createId } from '@/lib/cad/model';
import type {
    CadDocument,
    CadElement,
    DoorType,
    LocationLine,
    Point,
    WallType,
    WindowType,
} from '@/lib/cad/types';

export type TypeLibrary = {
    /** `vanhaven.types` is the pre-rename marker, still accepted on import. */
    kind?: 'axon.types' | 'vanhaven.types';
    wallTypes?: WallType[];
    doorTypes?: DoorType[];
    windowTypes?: WindowType[];
};

export type InsertSummary = {
    /** Human readable list of what landed in the model. */
    added: string[];
    /** Ids of the new elements, so the editor can select them afterwards. */
    ids: string[];
};

export type InsertResult = {
    document: CadDocument;
    summary: InsertSummary;
};

/* ------------------------------------------------------------- detection */

export function isTypeLibrary(value: unknown): value is TypeLibrary {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const candidate = value as TypeLibrary;

    if (
        candidate.kind === 'axon.types' ||
        candidate.kind === 'vanhaven.types'
    ) {
        return true;
    }

    const hasTypes =
        Array.isArray(candidate.wallTypes) ||
        Array.isArray(candidate.doorTypes) ||
        Array.isArray(candidate.windowTypes);

    return (
        hasTypes && !Array.isArray((candidate as Partial<CadDocument>).elements)
    );
}

export function isCadDocument(value: unknown): value is CadDocument {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const candidate = value as Partial<CadDocument>;

    return Array.isArray(candidate.elements) && Array.isArray(candidate.levels);
}

/* --------------------------------------------------------- type libraries */

/** Pull the current project's types out as a reusable library. */
export function extractTypeLibrary(document: CadDocument): TypeLibrary {
    return {
        kind: 'axon.types',
        wallTypes: document.wallTypes,
        doorTypes: document.doorTypes,
        windowTypes: document.windowTypes,
    };
}

/**
 * Merge a type library in, skipping ids that already exist so importing the
 * same catalogue twice is a no-op rather than a pile of duplicates.
 */
export function insertTypeLibrary(
    document: CadDocument,
    library: TypeLibrary,
): InsertResult {
    const added: string[] = [];

    const merge = <T extends { id: string; name: string }>(
        existing: T[],
        incoming: T[] | undefined,
        label: string,
    ): T[] => {
        if (!incoming || incoming.length === 0) {
            return existing;
        }

        const known = new Set(existing.map((type) => type.id));
        const fresh = incoming.filter(
            (type) => type?.id && !known.has(type.id),
        );

        if (fresh.length > 0) {
            added.push(`${fresh.length} ${label}`);
        }

        return [...existing, ...fresh];
    };

    return {
        document: {
            ...document,
            wallTypes: merge(
                document.wallTypes,
                library.wallTypes,
                'wall types',
            ),
            doorTypes: merge(
                document.doorTypes,
                library.doorTypes,
                'door types',
            ),
            windowTypes: merge(
                document.windowTypes,
                library.windowTypes,
                'window types',
            ),
        },
        summary: { added: added.length > 0 ? added : ['nothing new'], ids: [] },
    };
}

/* ------------------------------------------------------------- documents */

export type DocumentInsertMode = 'replace' | 'merge';

/**
 * Bring another model in, either wholesale or as extra geometry on the
 * current level. Merging remaps every id so the two models cannot collide,
 * and keeps openings attached to the wall they came in on.
 */
export function insertDocument(
    document: CadDocument,
    incoming: CadDocument,
    mode: DocumentInsertMode,
    levelId: string,
): InsertResult {
    if (mode === 'replace') {
        return {
            document: incoming,
            summary: {
                added: [
                    `${incoming.elements.length} elements`,
                    `${incoming.levels.length} levels`,
                ],
                ids: [],
            },
        };
    }

    const withTypes = insertTypeLibrary(
        document,
        extractTypeLibrary(incoming),
    ).document;
    const remap = new Map<string, string>();

    incoming.elements.forEach((element) => {
        remap.set(element.id, createId(element.kind));
    });

    const elements = incoming.elements.map((element) => {
        const copy = {
            ...element,
            id: remap.get(element.id) as string,
            level: levelId,
        };

        if (copy.kind === 'door' || copy.kind === 'window') {
            return { ...copy, host: remap.get(copy.host) ?? copy.host };
        }

        return copy;
    }) as CadElement[];

    // An opening whose host did not come across would be orphaned.
    const hosts = new Set(
        elements
            .filter((element) => element.kind === 'wall')
            .map((element) => element.id),
    );
    const kept = elements.filter(
        (element) =>
            (element.kind !== 'door' && element.kind !== 'window') ||
            hosts.has(element.host),
    );

    return {
        document: { ...withTypes, elements: [...withTypes.elements, ...kept] },
        summary: {
            added: [`${kept.length} elements`],
            ids: kept.map((element) => element.id),
        },
    };
}

/* ------------------------------------------------------------------- DXF */

export type DxfInsertOptions = {
    levelId: string;
    /** Turn the imported geometry into walls, or leave it as reference lines. */
    as: 'walls' | 'lines';
    /** Only bring in these DXF layers. Empty means all of them. */
    layers?: string[];
    wallTypeId: string;
    wallHeight: number;
    locationLine: LocationLine;
    /** Extra scale on top of the drawing's own units, e.g. 1000 for a metre file. */
    scale?: number;
    /** Shift applied after scaling, used to drop the drawing near the origin. */
    offset?: Point;
};

/** Segments shorter than this are dropped as drawing noise. */
const MINIMUM_SEGMENT = 20;

export function insertDxf(
    document: CadDocument,
    polylines: DxfPolyline[],
    options: DxfInsertOptions,
): InsertResult {
    const scale = options.scale ?? 1;
    const offset = options.offset ?? { x: 0, y: 0 };
    const wanted =
        options.layers && options.layers.length > 0
            ? new Set(options.layers)
            : null;
    const elements: CadElement[] = [];

    polylines
        .filter((polyline) => !wanted || wanted.has(polyline.layer))
        .forEach((polyline) => {
            const points = polyline.points.map((point) => ({
                x: point.x * scale + offset.x,
                y: point.y * scale + offset.y,
            }));
            const segments = toSegments(points, polyline.closed);

            segments.forEach(([a, b]) => {
                if (distance(a, b) < MINIMUM_SEGMENT) {
                    return;
                }

                elements.push(
                    options.as === 'walls'
                        ? {
                              id: createId('wall'),
                              kind: 'wall',
                              level: options.levelId,
                              typeId: options.wallTypeId,
                              a,
                              b,
                              height: options.wallHeight,
                              baseOffset: 0,
                              locationLine: options.locationLine,
                          }
                        : {
                              id: createId('line'),
                              kind: 'line',
                              level: options.levelId,
                              a,
                              b,
                          },
                );
            });
        });

    return {
        document: {
            ...document,
            elements: [...document.elements, ...elements],
        },
        summary: {
            added: [
                `${elements.length} ${options.as === 'walls' ? 'walls' : 'detail lines'}`,
            ],
            ids: elements.map((element) => element.id),
        },
    };
}

function toSegments(points: Point[], closed: boolean): [Point, Point][] {
    const segments: [Point, Point][] = [];
    const limit = closed ? points.length : points.length - 1;

    for (let index = 0; index < limit; index++) {
        segments.push([points[index], points[(index + 1) % points.length]]);
    }

    return segments;
}

/* ------------------------------------------------------------------ mesh */

export type MeshInsertOptions = {
    levelId: string;
    at: Point;
    /** Scale applied to the imported units, e.g. 1000 when the file is in metres. */
    scale: number;
    rotation?: number;
    baseOffset?: number;
};

export function insertMesh(
    document: CadDocument,
    mesh: ImportedMesh,
    options: MeshInsertOptions,
): InsertResult {
    const id = createId('mesh');

    return {
        document: {
            ...document,
            elements: [
                ...document.elements,
                {
                    id,
                    kind: 'mesh',
                    level: options.levelId,
                    name: mesh.name,
                    p: options.at,
                    rotation: options.rotation ?? 0,
                    scale: options.scale,
                    baseOffset: options.baseOffset ?? 0,
                    vertices: mesh.vertices,
                    footprint: mesh.footprint,
                    size: mesh.size,
                },
            ],
        },
        summary: {
            added: [
                `${mesh.name} (${mesh.triangleCount.toLocaleString('en-CA')} triangles)`,
            ],
            ids: [id],
        },
    };
}
