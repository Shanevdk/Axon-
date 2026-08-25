/**
 * Turns a model into a description of the building it draws.
 *
 * The render feature hands this text to an image generator, so it reads the
 * document for the handful of facts a photograph would actually show — how
 * many storeys, how big the footprint is, how much glass there is, what the
 * roof does — and says nothing about anything else. Every length in the
 * document is millimetres; the brief speaks in metres because that is the
 * language image models understand.
 */

import type {
    CadDocument,
    ColumnElement,
    DoorElement,
    FloorElement,
    RoofElement,
    WallElement,
    WindowElement,
    WindowType,
} from '@/lib/cad/types';

/** Lighting and treatment presets, in the language of architectural photography. */
export const RENDER_STYLES = {
    daylight: {
        label: 'Daylight',
        phrase: 'bright midday sun, clear blue sky, crisp shadows',
    },
    golden: {
        label: 'Golden hour',
        phrase: 'low golden-hour sun, long warm shadows, glowing glazing',
    },
    dusk: {
        label: 'Dusk',
        phrase: 'blue-hour dusk, deep blue sky, warm interior lights spilling out',
    },
    overcast: {
        label: 'Overcast',
        phrase: 'soft overcast light, no harsh shadows, muted even tones',
    },
    massing: {
        label: 'White model',
        phrase: 'pure white physical massing model on a plain white sweep, studio lighting, no materials, no colour',
    },
    interior: {
        label: 'Interior',
        phrase: 'interior view from inside the main space, daylight through the windows, furnished simply',
    },
} as const;

export type RenderStyle = keyof typeof RENDER_STYLES;

/** Frame proportions offered in the dialog. */
export const RENDER_ASPECTS = {
    wide: { label: 'Wide 16:9', width: 1216, height: 684 },
    classic: { label: 'Classic 4:3', width: 1024, height: 768 },
    square: { label: 'Square 1:1', width: 1024, height: 1024 },
} as const;

export type RenderAspect = keyof typeof RENDER_ASPECTS;

/** The measured facts, kept separate so the dialog can show its working. */
export type DesignBrief = {
    /** Fact lines shown beside the prompt, already worded for a person. */
    facts: string[];
    /** The sentence handed to the image model. */
    prompt: string;
    /** True when there is not enough drawn to describe a building yet. */
    empty: boolean;
};

/** Half a metre of glazing per metre of wall already reads as "a lot of glass". */
const GLAZING_IS_GENEROUS = 0.35;

/** Anything shallower than this reads as a flat roof in a photograph. */
const FLAT_ROOF_DEGREES = 5;

/**
 * Read the model and describe the building it draws.
 */
export function describeDesign(document: CadDocument): DesignBrief {
    const walls = elementsOf<WallElement>(document, 'wall');
    const floors = elementsOf<FloorElement>(document, 'floor');
    const roofs = elementsOf<RoofElement>(document, 'roof');
    const windows = elementsOf<WindowElement>(document, 'window');
    const doors = elementsOf<DoorElement>(document, 'door');
    const columns = elementsOf<ColumnElement>(document, 'column');

    if (walls.length === 0 && floors.length === 0 && roofs.length === 0) {
        return {
            facts: [],
            prompt: '',
            empty: true,
        };
    }

    const facts: string[] = [];
    const clauses: string[] = [];

    const storeys = storeyCount(walls);
    const height = overallHeight(document, walls);

    facts.push(
        storeys === 1
            ? 'Single storey'
            : `${storeys} storeys, about ${metres(height)} m to the eaves`,
    );
    clauses.push(
        storeys === 1
            ? 'a single-storey building'
            : `a ${storeys}-storey building roughly ${metres(height)} metres tall`,
    );

    const extent = footprint([
        ...walls.flatMap((wall) => [wall.a, wall.b]),
        ...floors.flatMap((floor) => floor.points),
        ...roofs.flatMap((roof) => roof.points),
    ]);

    if (extent) {
        facts.push(
            `Footprint about ${metres(extent.width)} × ${metres(extent.depth)} m`,
        );
        clauses.push(
            `a footprint of about ${metres(extent.width)} by ${metres(extent.depth)} metres`,
        );
    }

    const area = floors.reduce(
        (total, floor) => total + polygonArea(floor.points),
        0,
    );

    if (area > 0) {
        facts.push(`Floor area about ${squareMetres(area)} m²`);
    }

    const glazing = glazingRatio(document, walls, windows);

    if (windows.length > 0) {
        facts.push(
            `${windows.length} window${windows.length === 1 ? '' : 's'}${
                glazing >= GLAZING_IS_GENEROUS ? ', heavily glazed' : ''
            }`,
        );
        clauses.push(
            glazing >= GLAZING_IS_GENEROUS
                ? 'large expanses of glazing across the facade'
                : `${windows.length} punched window${windows.length === 1 ? '' : 's'} in solid walls`,
        );
    }

    if (doors.length > 0) {
        facts.push(`${doors.length} door${doors.length === 1 ? '' : 's'}`);
    }

    const curtain = walls.filter(
        (wall) => wallFunction(document, wall) === 'curtain',
    );

    if (curtain.length > 0) {
        facts.push('Curtain walling');
        clauses.push(
            'a full-height glazed curtain wall with slim dark mullions',
        );
    }

    const roof = roofDescription(roofs);

    if (roof) {
        facts.push(roof.fact);
        clauses.push(roof.clause);
    } else if (walls.length > 0) {
        facts.push('No roof drawn — reads as flat');
        clauses.push('a flat roof with a clean parapet');
    }

    if (columns.length > 0) {
        facts.push(
            `${columns.length} exposed column${columns.length === 1 ? '' : 's'}`,
        );
        clauses.push('slender exposed structural columns');
    }

    const material = dominantMaterial(document, walls);

    if (material) {
        facts.push(`Mostly ${material}`);
        clauses.push(`${material} cladding`);
    }

    return {
        facts,
        prompt: sentence(clauses),
        empty: false,
    };
}

/**
 * Compose the full instruction sent to the image model: the building, the
 * light, and the standing rule that nothing else may appear in the frame.
 */
export function renderPrompt(prompt: string, style: RenderStyle): string {
    return [
        'Architectural photograph of',
        prompt.trim().replace(/\.$/, ''),
        `— ${RENDER_STYLES[style].phrase}.`,
        'Show only this one building, isolated, with plain uncluttered surroundings.',
        'No other buildings, no cars, no people, no text, no watermark, no logo.',
        'Shot on a full-frame camera with a tilt-shift lens, verticals perfectly straight, sharp focus throughout.',
    ].join(' ');
}

/* ------------------------------------------------------------------ facts */

function elementsOf<T>(document: CadDocument, kind: string): T[] {
    return document.elements.filter(
        (element) =>
            element.kind === kind && (element.phase ?? 'new') !== 'demolished',
    ) as T[];
}

/**
 * How many storeys are actually built, counted as the levels carrying walls
 * rather than the levels the project happens to define.
 */
function storeyCount(walls: WallElement[]): number {
    return Math.max(1, new Set(walls.map((wall) => wall.level)).size);
}

/**
 * Top of the tallest wall above the lowest level, in millimetres.
 */
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

/**
 * Bounding box of everything drawn, in millimetres.
 */
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

/**
 * Glazed area as a fraction of exterior wall area — the number that decides
 * whether a facade reads as punched openings or as a glass box.
 */
function glazingRatio(
    document: CadDocument,
    walls: WallElement[],
    windows: WindowElement[],
): number {
    const types = new Map<string, WindowType>(
        (document.windowTypes ?? []).map((type) => [type.id, type]),
    );

    const wallArea = walls.reduce(
        (total, wall) => total + length(wall.a, wall.b) * wall.height,
        0,
    );

    if (wallArea <= 0) {
        return 0;
    }

    const glassArea = windows.reduce((total, window) => {
        const type = types.get(window.typeId);

        return total + (type ? type.width * type.height : 0);
    }, 0);

    return glassArea / wallArea;
}

function roofDescription(
    roofs: RoofElement[],
): { fact: string; clause: string } | null {
    if (roofs.length === 0) {
        return null;
    }

    const steepest = roofs.reduce(
        (steep, roof) => Math.max(steep, roof.slope),
        0,
    );

    if (steepest < FLAT_ROOF_DEGREES) {
        return {
            fact: 'Flat roof',
            clause: 'a flat roof with a clean parapet',
        };
    }

    return {
        fact: `Pitched roof at ${Math.round(steepest)}°`,
        clause: `a pitched roof at about ${Math.round(steepest)} degrees with a standing-seam metal finish`,
    };
}

/**
 * Guess the cladding from the wall type carrying the most length. Type names
 * are the only material the document holds, so they are read for a keyword.
 */
function dominantMaterial(
    document: CadDocument,
    walls: WallElement[],
): string | null {
    const names = new Map(
        document.wallTypes.map((type) => [type.id, type.name.toLowerCase()]),
    );
    const totals = new Map<string, number>();

    for (const wall of walls) {
        if (wallFunction(document, wall) === 'interior') {
            continue;
        }

        const name = names.get(wall.typeId);

        if (name) {
            totals.set(name, (totals.get(name) ?? 0) + length(wall.a, wall.b));
        }
    }

    const leader = [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

    if (!leader) {
        return null;
    }

    const keywords: [string, string][] = [
        ['brick', 'brick'],
        ['timber', 'vertical timber board'],
        ['wood', 'vertical timber board'],
        ['concrete', 'board-formed concrete'],
        ['block', 'concrete block'],
        ['stone', 'stone'],
        ['metal', 'standing-seam metal'],
        ['render', 'smooth render'],
        ['stucco', 'smooth render'],
        ['curtain', 'glass and dark metal'],
    ];

    for (const [needle, material] of keywords) {
        if (leader.includes(needle)) {
            return material;
        }
    }

    return null;
}

function wallFunction(document: CadDocument, wall: WallElement): string {
    return (
        document.wallTypes.find((type) => type.id === wall.typeId)?.function ??
        'exterior'
    );
}

/* ------------------------------------------------------------------ maths */

function length(
    a: { x: number; y: number },
    b: { x: number; y: number },
): number {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

function polygonArea(points: { x: number; y: number }[]): number {
    if (points.length < 3) {
        return 0;
    }

    let doubled = 0;

    for (let index = 0; index < points.length; index++) {
        const current = points[index];
        const next = points[(index + 1) % points.length];

        doubled += current.x * next.y - next.x * current.y;
    }

    return Math.abs(doubled) / 2;
}

function metres(millimetres: number): string {
    return (millimetres / 1000).toFixed(1).replace(/\.0$/, '');
}

function squareMetres(squareMillimetres: number): string {
    return Math.round(squareMillimetres / 1_000_000).toString();
}

function sentence(clauses: string[]): string {
    if (clauses.length === 0) {
        return '';
    }

    if (clauses.length === 1) {
        return clauses[0];
    }

    return `${clauses.slice(0, -1).join(', ')} and ${clauses.at(-1)}`;
}
