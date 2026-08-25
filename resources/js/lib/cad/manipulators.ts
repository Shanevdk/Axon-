/**
 * The controls Revit puts on a selected element: drag grips, flip arrows and
 * the blue temporary dimensions.
 *
 * Geometry lives here rather than in the renderer because the drawing canvas
 * has to hit-test exactly what was drawn. Everything is in model millimetres;
 * the caller converts to screen space.
 */

import {
    add,
    distance,
    lerp,
    midpoint,
    normalize,
    perpendicular,
    scale,
    subtract,
} from '@/lib/cad/geometry';
import {
    buildOpeningGeometry,
    clampOpeningParameter,
    openingSize,
} from '@/lib/cad/model';
import type { WallGeometry } from '@/lib/cad/model';
import type {
    CadDocument,
    CadElement,
    DimensionElement,
    FloorElement,
    LineElement,
    OpeningElement,
    Point,
    RoofElement,
    WallElement,
} from '@/lib/cad/types';

/** Screen-space radius used to both draw and pick a grip. */
export const GRIP_RADIUS = 4.5;

/** Screen-space distance a flip control sits off the element it belongs to. */
export const FLIP_OFFSET = 22;

export type Grip =
    | { kind: 'wallEnd'; elementId: string; end: 'a' | 'b'; point: Point }
    | { kind: 'lineEnd'; elementId: string; end: 'a' | 'b'; point: Point }
    | { kind: 'floorVertex'; elementId: string; index: number; point: Point }
    | { kind: 'openingSlide'; elementId: string; point: Point }
    | { kind: 'dimensionOffset'; elementId: string; point: Point }
    | { kind: 'move'; elementId: string; point: Point };

export type FlipControl = {
    elementId: string;
    /** `face` swings the element through the wall, `hand` mirrors it along. */
    axis: 'face' | 'hand';
    /** Anchor in model space; the arrow is drawn at a fixed screen offset. */
    anchor: Point;
    /** Unit direction the arrow points, in model space. */
    direction: Point;
};

/**
 * A blue temporary dimension. `apply` returns the document that results from
 * typing a new value into it, so the canvas never has to know the maths.
 */
export type TemporaryDimension = {
    id: string;
    /** Witness line references. */
    a: Point;
    b: Point;
    /** Signed offset from the a→b line the dimension string sits at. */
    offset: number;
    value: number;
    apply: (document: CadDocument, next: number) => CadDocument;
};

function selectedElements(
    document: CadDocument,
    selection: string[],
): CadElement[] {
    const ids = new Set(selection);

    return document.elements.filter((element) => ids.has(element.id));
}

/* ------------------------------------------------------------------ grips */

export function gripsFor(
    document: CadDocument,
    selection: string[],
    geometry: Map<string, WallGeometry>,
): Grip[] {
    const grips: Grip[] = [];

    selectedElements(document, selection).forEach((element) => {
        switch (element.kind) {
            case 'wall':
                grips.push(
                    {
                        kind: 'wallEnd',
                        elementId: element.id,
                        end: 'a',
                        point: element.a,
                    },
                    {
                        kind: 'wallEnd',
                        elementId: element.id,
                        end: 'b',
                        point: element.b,
                    },
                );
                break;
            case 'line':
            case 'dimension': {
                const ends: ('a' | 'b')[] = ['a', 'b'];

                if (element.kind === 'line') {
                    ends.forEach((end) =>
                        grips.push({
                            kind: 'lineEnd',
                            elementId: element.id,
                            end,
                            point: element[end],
                        }),
                    );
                } else {
                    grips.push({
                        kind: 'dimensionOffset',
                        elementId: element.id,
                        point: dimensionHandle(element),
                    });
                }

                break;
            }
            case 'floor':
            case 'roof':
            case 'ceiling':
                element.points.forEach((point, index) =>
                    grips.push({
                        kind: 'floorVertex',
                        elementId: element.id,
                        index,
                        point,
                    }),
                );
                break;
            case 'stair':
            case 'grid':
            case 'beam':
                (['a', 'b'] as const).forEach((end) =>
                    grips.push({
                        kind: 'lineEnd',
                        elementId: element.id,
                        end,
                        point: element[end],
                    }),
                );
                break;
            case 'door':
            case 'window': {
                const host = geometry.get(element.host);

                if (host) {
                    grips.push({
                        kind: 'openingSlide',
                        elementId: element.id,
                        point: buildOpeningGeometry(document, element, host)
                            .center,
                    });
                }

                break;
            }
            case 'column':
            case 'text':
            case 'room':
                grips.push({
                    kind: 'move',
                    elementId: element.id,
                    point: element.p,
                });
                break;
        }
    });

    return grips;
}

function dimensionHandle(dimension: DimensionElement): Point {
    const direction = normalize(subtract(dimension.b, dimension.a));
    const normal = perpendicular(direction);

    return add(
        midpoint(dimension.a, dimension.b),
        scale(normal, dimension.offset),
    );
}

/**
 * Move whatever a grip is attached to onto `target`.
 */
export function applyGrip(
    document: CadDocument,
    grip: Grip,
    target: Point,
    geometry: Map<string, WallGeometry>,
): CadDocument {
    return {
        ...document,
        elements: document.elements.map((element) => {
            if (element.id !== grip.elementId) {
                return element;
            }

            switch (grip.kind) {
                case 'wallEnd':
                    return { ...(element as WallElement), [grip.end]: target };
                case 'lineEnd':
                    return {
                        ...(element as LineElement),
                        [grip.end]: target,
                    } as CadElement;
                case 'floorVertex': {
                    const floor = element as FloorElement | RoofElement;

                    return {
                        ...floor,
                        points: floor.points.map((point, index) =>
                            index === grip.index ? target : point,
                        ),
                    };
                }
                case 'dimensionOffset': {
                    const dimension = element as DimensionElement;
                    const direction = normalize(
                        subtract(dimension.b, dimension.a),
                    );
                    const normal = perpendicular(direction);
                    const relative = subtract(
                        target,
                        midpoint(dimension.a, dimension.b),
                    );

                    return {
                        ...dimension,
                        offset: relative.x * normal.x + relative.y * normal.y,
                    };
                }
                case 'openingSlide': {
                    const opening = element as OpeningElement;
                    const host = geometry.get(opening.host);

                    if (!host) {
                        return element;
                    }

                    const along = subtract(target, host.a);
                    const t =
                        (along.x * host.direction.x +
                            along.y * host.direction.y) /
                        Math.max(host.length, 1);

                    return {
                        ...opening,
                        t: clampOpeningParameter(
                            openingSize(document, opening).width,
                            host.length,
                            t,
                        ),
                    };
                }
                case 'move':
                    return { ...element, p: target } as CadElement;
            }
        }),
    };
}

/* ----------------------------------------------------------------- flips */

export function flipControlsFor(
    document: CadDocument,
    selection: string[],
    geometry: Map<string, WallGeometry>,
): FlipControl[] {
    const controls: FlipControl[] = [];

    selectedElements(document, selection).forEach((element) => {
        if (element.kind !== 'door' && element.kind !== 'window') {
            return;
        }

        const host = geometry.get(element.host);

        if (!host) {
            return;
        }

        const opening = buildOpeningGeometry(document, element, host);

        controls.push(
            {
                elementId: element.id,
                axis: 'face',
                anchor: opening.center,
                direction: host.normal,
            },
            {
                elementId: element.id,
                axis: 'hand',
                anchor: opening.center,
                direction: host.direction,
            },
        );
    });

    return controls;
}

/* --------------------------------------------------- temporary dimensions */

/**
 * Build the temporary dimensions Revit shows for a single selected element: a
 * wall reports its own length, an opening reports the distance from each end
 * of its host.
 */
export function temporaryDimensionsFor(
    document: CadDocument,
    selection: string[],
    geometry: Map<string, WallGeometry>,
): TemporaryDimension[] {
    if (selection.length !== 1) {
        return [];
    }

    const element = document.elements.find((item) => item.id === selection[0]);

    if (!element) {
        return [];
    }

    if (element.kind === 'wall') {
        return [wallLengthDimension(element)];
    }

    if (element.kind === 'door' || element.kind === 'window') {
        const host = geometry.get(element.host);

        return host ? openingDimensions(document, element, host) : [];
    }

    return [];
}

function wallLengthDimension(wall: WallElement): TemporaryDimension {
    return {
        id: `${wall.id}:length`,
        a: wall.a,
        b: wall.b,
        offset: 700,
        value: distance(wall.a, wall.b),
        apply: (document, next) => ({
            ...document,
            elements: document.elements.map((element) => {
                if (element.id !== wall.id || element.kind !== 'wall') {
                    return element;
                }

                const direction = normalize(subtract(element.b, element.a));

                // Revit stretches the end you did not draw from.
                return {
                    ...element,
                    b: add(element.a, scale(direction, next)),
                };
            }),
        }),
    };
}

function openingDimensions(
    document: CadDocument,
    opening: OpeningElement,
    host: WallGeometry,
): TemporaryDimension[] {
    const geometry = buildOpeningGeometry(document, opening, host);
    const width = geometry.width;
    const centre = geometry.center;

    const retarget = (from: 'a' | 'b') => (next: number) => {
        const raw = from === 'a' ? next / host.length : 1 - next / host.length;

        return clampOpeningParameter(width, host.length, raw);
    };

    const build = (
        from: 'a' | 'b',
        anchor: Point,
        value: number,
    ): TemporaryDimension => ({
        id: `${opening.id}:${from}`,
        a: anchor,
        b: centre,
        offset: 500,
        value,
        apply: (current, next) => ({
            ...current,
            elements: current.elements.map((element) =>
                element.id === opening.id
                    ? { ...element, t: retarget(from)(next) }
                    : element,
            ),
        }),
    });

    return [
        build('a', host.a, distance(host.a, centre)),
        build('b', host.b, distance(host.b, centre)),
    ];
}

/**
 * Point on a temporary dimension where its editable value is drawn.
 */
export function temporaryDimensionAnchor(dimension: TemporaryDimension): Point {
    const direction = normalize(subtract(dimension.b, dimension.a));
    const normal = perpendicular(direction);

    return add(
        lerp(dimension.a, dimension.b, 0.5),
        scale(normal, dimension.offset),
    );
}
