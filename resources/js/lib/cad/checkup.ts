/**
 * Revit's Review Warnings and Purge Unused, for the Manage tab.
 *
 * Nothing here blocks drawing — Revit's philosophy, kept deliberately: a
 * warning is a note pinned to the model, not a locked door. Everything is a
 * pure function of the document so the checks are cheap to test and safe to
 * run on every open of the dialog.
 */

import {
    checkWallTypes,
    formatResistance,
    requirementFor,
} from '@/lib/cad/code';
import { distance } from '@/lib/cad/geometry';
import {
    doorTypeOf,
    elementDisplayName,
    maxOpeningWidth,
    openingSize,
    wallTypeOf,
    windowTypeOf,
} from '@/lib/cad/model';
import type {
    CadDocument,
    CadElement,
    OpeningElement,
    RoomElement,
    WallElement,
} from '@/lib/cad/types';

export type ReviewSeverity = 'error' | 'warning';

export type ReviewWarning = {
    id: string;
    severity: ReviewSeverity;
    /** Worded the way Revit words its warnings: flat, factual, fixable. */
    message: string;
    /** The elements at fault, so the dialog can select them on click. */
    elementIds: string[];
};

/** Below this a wall is a dot pretending, usually left by a stray click. */
const WALL_WORTH_KEEPING = 10;

/**
 * Read the model and report what a careful drafter would flag.
 */
export function reviewDocument(
    document: CadDocument,
    jurisdiction?: string | null,
): ReviewWarning[] {
    const warnings: ReviewWarning[] = [
        ...orphanedOpenings(document),
        ...crowdedOpenings(document),
        ...degenerateWalls(document),
        ...missingLevels(document),
        ...missingTypes(document),
        ...duplicateRoomNumbers(document),
        ...duplicateMarks(document),
        ...wallsBelowCode(document, jurisdiction),
    ];

    // Errors first, then a stable reading order within each severity.
    return warnings.sort((a, b) =>
        a.severity === b.severity
            ? a.message.localeCompare(b.message)
            : a.severity === 'error'
              ? -1
              : 1,
    );
}

/**
 * How many warnings a document carries, for a badge.
 */
export function reviewCount(
    document: CadDocument,
    jurisdiction?: string | null,
): number {
    return reviewDocument(document, jurisdiction).length;
}

/**
 * Exterior wall types that fall short of the energy code where the building
 * is, when the project says where that is.
 *
 * This is a warning like every other one here: advisory, never a locked door.
 * The estimate behind it is rough and the table behind it is small, so the
 * message names the authority and the shortfall and lets the architect
 * decide — which is the same posture the code consultant takes.
 */
function wallsBelowCode(
    document: CadDocument,
    jurisdiction?: string | null,
): ReviewWarning[] {
    const requirement = requirementFor(jurisdiction);

    if (!requirement) {
        return [];
    }

    const inUse = new Set(
        document.elements
            .filter((element) => element.kind === 'wall')
            .map((element) => (element as WallElement).typeId),
    );

    return checkWallTypes(document, requirement)
        .filter((check) => !check.passes && inUse.has(check.type.id))
        .map((check) => ({
            id: `code-${check.type.id}`,
            severity: 'warning' as const,
            message:
                `${check.type.name} is about ${formatResistance(check.rsi, document.units)} effective; ` +
                `${requirement.region} asks for ${formatResistance(check.requiredRsi, document.units)} ` +
                `(${requirement.authority}, zone ${requirement.zone}). ` +
                (check.fixableByThickening
                    ? `About ${check.suggestedThickness}mm would do it.`
                    : 'Thickening will not fix it — this one needs insulation added.'),
            elementIds: document.elements
                .filter(
                    (element) =>
                        element.kind === 'wall' &&
                        (element as WallElement).typeId === check.type.id,
                )
                .map((element) => element.id),
        }));
}

/**
 * Revit's Purge Unused, scoped to the type catalogues: drop every wall, door
 * and window type nothing references. The first type of each catalogue is
 * always kept — the editor and the placement tools assume the catalogues are
 * never empty.
 */
export function purgeUnusedTypes(document: CadDocument): {
    document: CadDocument;
    purged: number;
} {
    const used = {
        wall: new Set<string>(),
        door: new Set<string>(),
        window: new Set<string>(),
    };

    for (const element of document.elements) {
        if (element.kind === 'wall') {
            used.wall.add(element.typeId);
        } else if (element.kind === 'door') {
            used.door.add(element.typeId);
        } else if (element.kind === 'window') {
            used.window.add(element.typeId);
        }
    }

    const keep = <T extends { id: string }>(
        types: T[],
        wanted: Set<string>,
    ): T[] => {
        const kept = types.filter(
            (type, index) => index === 0 || wanted.has(type.id),
        );

        return kept.length > 0 ? kept : types.slice(0, 1);
    };

    const wallTypes = keep(document.wallTypes, used.wall);
    const doorTypes = keep(document.doorTypes, used.door);
    const windowTypes = keep(document.windowTypes, used.window);

    const purged =
        document.wallTypes.length -
        wallTypes.length +
        (document.doorTypes.length - doorTypes.length) +
        (document.windowTypes.length - windowTypes.length);

    return {
        document: { ...document, wallTypes, doorTypes, windowTypes },
        purged,
    };
}

/* ----------------------------------------------------------------- checks */

function openings(document: CadDocument): OpeningElement[] {
    return document.elements.filter(
        (element): element is OpeningElement =>
            element.kind === 'door' || element.kind === 'window',
    );
}

function walls(document: CadDocument): WallElement[] {
    return document.elements.filter(
        (element): element is WallElement => element.kind === 'wall',
    );
}

/**
 * A door or window whose wall has gone. Revit deletes these with the host;
 * an imported or hand-edited drawing can still arrive with them.
 */
function orphanedOpenings(document: CadDocument): ReviewWarning[] {
    const hosts = new Set(walls(document).map((wall) => wall.id));

    return openings(document)
        .filter((opening) => !hosts.has(opening.host))
        .map((opening) => ({
            id: `orphan:${opening.id}`,
            severity: 'error' as const,
            message: `${elementDisplayName(document, opening)} has lost the wall that hosted it.`,
            elementIds: [opening.id],
        }));
}

/**
 * An opening wider than its host can carry — usually a resized window on a
 * wall that was later shortened.
 */
function crowdedOpenings(document: CadDocument): ReviewWarning[] {
    const byId = new Map(walls(document).map((wall) => [wall.id, wall]));

    return openings(document).flatMap((opening) => {
        const host = byId.get(opening.host);

        if (!host) {
            return [];
        }

        const room = maxOpeningWidth(distance(host.a, host.b));
        const { width } = openingSize(document, opening);

        if (width <= room) {
            return [];
        }

        return [
            {
                id: `crowded:${opening.id}`,
                severity: 'warning' as const,
                message: `${elementDisplayName(document, opening)} is ${Math.round(width)} mm wide but its wall only has room for ${Math.round(room)} mm.`,
                elementIds: [opening.id, host.id],
            },
        ];
    });
}

function degenerateWalls(document: CadDocument): ReviewWarning[] {
    return walls(document)
        .filter((wall) => distance(wall.a, wall.b) < WALL_WORTH_KEEPING)
        .map((wall) => ({
            id: `degenerate:${wall.id}`,
            severity: 'warning' as const,
            message: `A ${wallTypeOf(document, wall.typeId).name} wall has almost no length — probably a stray click.`,
            elementIds: [wall.id],
        }));
}

function missingLevels(document: CadDocument): ReviewWarning[] {
    const levels = new Set(document.levels.map((level) => level.id));

    return document.elements
        .filter((element) => !levels.has(element.level))
        .map((element) => ({
            id: `level:${element.id}`,
            severity: 'error' as const,
            message: `${elementDisplayName(document, element)} sits on a level that no longer exists.`,
            elementIds: [element.id],
        }));
}

/**
 * A type reference that resolves only by fallback. The lookups quietly
 * substitute the first type of the catalogue, so the element draws — this is
 * the place where that substitution is said out loud.
 */
function missingTypes(document: CadDocument): ReviewWarning[] {
    const warnings: ReviewWarning[] = [];

    for (const element of document.elements) {
        const missing =
            (element.kind === 'wall' &&
                wallTypeOf(document, element.typeId).id !== element.typeId) ||
            (element.kind === 'door' &&
                doorTypeOf(document, element.typeId).id !== element.typeId) ||
            (element.kind === 'window' &&
                windowTypeOf(document, element.typeId).id !== element.typeId);

        if (missing) {
            warnings.push({
                id: `type:${element.id}`,
                severity: 'warning',
                message: `${elementDisplayName(document, element)} references a type that no longer exists and is drawn with a stand-in.`,
                elementIds: [element.id],
            });
        }
    }

    return warnings;
}

function duplicateRoomNumbers(document: CadDocument): ReviewWarning[] {
    const rooms = document.elements.filter(
        (element): element is RoomElement =>
            element.kind === 'room' && element.number.trim() !== '',
    );

    return duplicated(
        rooms,
        (room) => room.number.trim(),
        (number, ids) => ({
            id: `room-number:${number}`,
            severity: 'warning',
            message: `${ids.length} rooms share the number ${number}.`,
            elementIds: ids,
        }),
    );
}

/**
 * Two elements of the same category wearing the same Mark — Revit's most
 * famous warning, earned honestly here because Copy carries the mark across.
 */
function duplicateMarks(document: CadDocument): ReviewWarning[] {
    const marked = document.elements.filter(
        (element) => (element.mark ?? '').trim() !== '',
    );

    return duplicated(
        marked,
        (element) => `${element.kind}:${element.mark?.trim()}`,
        (key, ids) => ({
            id: `mark:${key}`,
            severity: 'warning',
            message: `${ids.length} elements share the Mark ${key.split(':')[1]}.`,
            elementIds: ids,
        }),
    );
}

function duplicated<T extends CadElement>(
    elements: T[],
    keyOf: (element: T) => string,
    warn: (key: string, ids: string[]) => ReviewWarning,
): ReviewWarning[] {
    const byKey = new Map<string, string[]>();

    for (const element of elements) {
        const key = keyOf(element);
        byKey.set(key, [...(byKey.get(key) ?? []), element.id]);
    }

    return [...byKey.entries()]
        .filter(([, ids]) => ids.length > 1)
        .map(([key, ids]) => warn(key, ids));
}
