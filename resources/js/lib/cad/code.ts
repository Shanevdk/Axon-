/**
 * What the walls have to do where the building is.
 *
 * The project carries a jurisdiction — "Vancouver, British Columbia, Canada"
 * — and the energy codes set a minimum effective thermal resistance for
 * above-grade walls that depends on the climate zone that jurisdiction sits
 * in. This turns one into the other, works out what the walls actually
 * achieve, and says which fall short.
 *
 * Two honesties are built in and should stay. The first: this is a small
 * table of prescriptive wall minimums, not a building code. It knows nothing
 * about fire separation, structure, seismic, zoning or any of the hundred
 * other things a real review covers, and it names the authority so the number
 * can be checked. The second: the effective R is an estimate from the
 * build-up, not a calculated assembly — it accounts for framing but not for
 * your particular details. Both are worth saying out loud wherever this is
 * shown, the same way the code consultant says it.
 *
 * Resistance is held in RSI (m²·K/W), which is what the Canadian tables are
 * written in. `formatResistance()` prints R-values where the drawing is
 * imperial.
 */

import { constructionOf, wallLayers } from '@/lib/cad/model';
import type {
    CadDocument,
    Construction,
    Units,
    WallType,
} from '@/lib/cad/types';

/** RSI to the R-value the same assembly would be quoted at in feet. */
const R_PER_RSI = 5.678263;

export type WallCodeRequirement = {
    /** The place this was matched on, as the table names it. */
    region: string;
    /** Who says so, named so the number can be checked. */
    authority: string;
    /** The climate zone the requirement is drawn from. */
    zone: string;
    /** Minimum effective thermal resistance of an above-grade wall, RSI. */
    minimumRsi: number;
};

/**
 * Above-grade wall minimums by climate zone.
 *
 * Canadian figures follow NBC 9.36.2.6 Table 9.36.2.6.-A, the column for a
 * building without heat-recovery ventilation, which is the conservative one.
 * Provinces are listed at the zone most of their populated area sits in —
 * British Columbia's coast is zone 4 and its interior is colder, so anything
 * away from the coast should be checked against the local table.
 */
const CANADA: { match: string[]; region: string; zone: string; rsi: number }[] =
    [
        {
            match: ['british columbia', 'vancouver', 'victoria', 'bc'],
            region: 'British Columbia (coastal)',
            zone: '4',
            rsi: 2.78,
        },
        {
            match: ['ontario', 'toronto', 'ottawa'],
            region: 'Ontario',
            zone: '6',
            rsi: 3.08,
        },
        {
            match: ['quebec', 'québec', 'montreal', 'montréal'],
            region: 'Quebec',
            zone: '6',
            rsi: 3.08,
        },
        {
            match: ['nova scotia', 'halifax'],
            region: 'Nova Scotia',
            zone: '6',
            rsi: 3.08,
        },
        {
            match: ['new brunswick', 'fredericton', 'moncton'],
            region: 'New Brunswick',
            zone: '6',
            rsi: 3.08,
        },
        {
            match: ['prince edward island', 'charlottetown'],
            region: 'Prince Edward Island',
            zone: '6',
            rsi: 3.08,
        },
        {
            match: ['newfoundland', 'labrador', "st. john's"],
            region: 'Newfoundland and Labrador',
            zone: '6',
            rsi: 3.08,
        },
        {
            match: ['alberta', 'calgary', 'edmonton'],
            region: 'Alberta',
            zone: '7A',
            rsi: 3.85,
        },
        {
            match: ['saskatchewan', 'regina', 'saskatoon'],
            region: 'Saskatchewan',
            zone: '7A',
            rsi: 3.85,
        },
        {
            match: ['manitoba', 'winnipeg'],
            region: 'Manitoba',
            zone: '7A',
            rsi: 3.85,
        },
        {
            match: ['yukon', 'whitehorse'],
            region: 'Yukon',
            zone: '7B',
            rsi: 3.85,
        },
        {
            match: ['northwest territories', 'yellowknife'],
            region: 'Northwest Territories',
            zone: '8',
            rsi: 4.67,
        },
        {
            match: ['nunavut', 'iqaluit'],
            region: 'Nunavut',
            zone: '8',
            rsi: 4.67,
        },
    ];

/** The national baseline, for a Canadian address the table cannot place. */
const CANADA_FALLBACK: WallCodeRequirement = {
    region: 'Canada',
    authority: 'NBC 2020, 9.36.2.6 (national baseline)',
    zone: '6',
    minimumRsi: 3.08,
};

/**
 * What the walls must achieve where this building is, or null when nowhere
 * has been named or the table does not cover it.
 *
 * Returning null is the honest answer for most of the world: the table is
 * Canadian, and pretending otherwise would be worse than saying nothing.
 */
export function requirementFor(
    jurisdiction: string | null | undefined,
): WallCodeRequirement | null {
    if (!jurisdiction) {
        return null;
    }

    const text = jurisdiction.toLowerCase();

    const found = CANADA.find((entry) =>
        entry.match.some((needle) => text.includes(needle)),
    );

    if (found) {
        return {
            region: found.region,
            authority: 'NBC 2020, 9.36.2.6',
            zone: found.zone,
            minimumRsi: found.rsi,
        };
    }

    return text.includes('canada') ? CANADA_FALLBACK : null;
}

/* --------------------------------------------------------- what walls do */

/**
 * Thermal resistance of batt insulation, RSI per millimetre. Fibreglass at
 * about R-3.6 an inch, which is the common one.
 */
const BATT_RSI_PER_MM = 0.0246;

/**
 * How much of a framed wall is stud rather than insulation. Studs conduct far
 * better than the batt between them, so a wall never achieves its nominal
 * value; a quarter framing fraction is the usual allowance at 400 centres
 * once plates, corners and openings are counted.
 */
const FRAMING_DERATE = 0.75;

/**
 * Air films, sheathing and board — the layers either side of the cavity,
 * which are worth about this much between them whatever the wall is.
 */
const SKIN_RSI = 0.3;

/** Concrete and masonry conduct; this is roughly what they resist per mm. */
const MASS_RSI_PER_MM = 0.0007;

/**
 * Roughly what a wall type achieves, RSI.
 *
 * This is an estimate off the build-up, not an assembly calculation: it takes
 * the cavity from `wallLayers()`, insulates it, derates it for framing and
 * adds the skins. Good enough to say a wall is nowhere near, and not good
 * enough to certify one.
 */
export function effectiveRsi(document: CadDocument, type: WallType): number {
    // A type is not an element, so ask what a wall of this type would be.
    const construction: Construction =
        type.construction ?? inferred(document, type);
    const { core } = wallLayers(type);

    if (construction === 'glazed') {
        // Double glazing, near enough. Nothing to insulate.
        return 0.35;
    }

    if (construction === 'concrete' || construction === 'masonry') {
        return core * MASS_RSI_PER_MM + SKIN_RSI;
    }

    if (construction === 'steel') {
        // Steel studs bridge far worse than timber ones.
        return core * BATT_RSI_PER_MM * 0.5 + SKIN_RSI;
    }

    return core * BATT_RSI_PER_MM * FRAMING_DERATE + SKIN_RSI;
}

/** What a wall of this type would be built of, when the type does not say. */
function inferred(document: CadDocument, type: WallType): Construction {
    return constructionOf(document, {
        id: 'probe',
        kind: 'wall',
        level: document.levels[0]?.id ?? '',
        typeId: type.id,
        a: { x: 0, y: 0 },
        b: { x: 1000, y: 0 },
        height: 2400,
        baseOffset: 0,
        locationLine: 'center',
    });
}

/**
 * The cavity a framed wall needs to reach a target, in millimetres.
 */
export function cavityForRsi(targetRsi: number): number {
    return Math.max(
        (targetRsi - SKIN_RSI) / (BATT_RSI_PER_MM * FRAMING_DERATE),
        0,
    );
}

/**
 * A framed wall thickness that would meet the requirement.
 *
 * `wallLayers()` takes its finishes as a fraction of the whole, so the cavity
 * is about three quarters of the thickness; this inverts that and rounds up
 * to the next ten millimetres so the answer is a dimension somebody would
 * actually draw.
 */
export function thicknessForRequirement(
    requirement: WallCodeRequirement,
): number {
    const cavity = cavityForRsi(requirement.minimumRsi);

    return Math.ceil(cavity / 0.76 / 10) * 10;
}

/* ------------------------------------------------------------- reporting */

export type WallCodeCheck = {
    type: WallType;
    /** What it achieves now. */
    rsi: number;
    /** What it has to achieve. */
    requiredRsi: number;
    /** True when it is at or above the requirement. */
    passes: boolean;
    /**
     * Whether a deeper wall would fix it.
     *
     * Only a wall with a cavity can be insulated by making it thicker. A
     * concrete or masonry wall barely resists heat however thick it gets —
     * it needs insulation added to it, which is a change to what the wall
     * is rather than to its dimension, and not something to do behind
     * somebody's back.
     */
    fixableByThickening: boolean;
    /** Thickness that would meet it, where thickening is the fix. */
    suggestedThickness: number;
};

/**
 * Check every exterior wall type in the document against the requirement.
 *
 * Only exterior types are checked: an interior partition separates two heated
 * rooms and has no thermal requirement to meet.
 */
export function checkWallTypes(
    document: CadDocument,
    requirement: WallCodeRequirement,
): WallCodeCheck[] {
    return document.wallTypes
        .filter((type) => type.function === 'exterior')
        .map((type) => {
            const rsi = effectiveRsi(document, type);
            const construction = type.construction ?? inferred(document, type);

            return {
                type,
                rsi,
                requiredRsi: requirement.minimumRsi,
                // A hair under is not a failure; the estimate is not that
                // precise, and a warning that fires on rounding is noise.
                passes: rsi >= requirement.minimumRsi - 0.05,
                fixableByThickening:
                    construction === 'wood' || construction === 'steel',
                suggestedThickness: thicknessForRequirement(requirement),
            };
        });
}

/**
 * Deepen every framed exterior wall type that falls short, so the walls meet
 * the requirement where the building is.
 *
 * Only the types change: no wall moves, and nothing that already passes is
 * touched. Walls follow their type, so the drawing updates itself.
 *
 * Concrete and masonry are reported rather than altered. Thickening them
 * would change the drawing without changing the answer — the fix is
 * insulation, which is a decision about the wall, not a dimension.
 */
export function bringWallsUpToCode(
    document: CadDocument,
    requirement: WallCodeRequirement,
): { document: CadDocument; upgraded: string[]; needsInsulation: string[] } {
    const short = checkWallTypes(document, requirement).filter(
        (check) => !check.passes,
    );
    const failing = short.filter((check) => check.fixableByThickening);
    const needsInsulation = short
        .filter((check) => !check.fixableByThickening)
        .map((check) => check.type.name);

    if (failing.length === 0) {
        return { document, upgraded: [], needsInsulation };
    }

    const wanted = new Map(
        failing.map((check) => [check.type.id, check.suggestedThickness]),
    );

    return {
        document: {
            ...document,
            wallTypes: document.wallTypes.map((type) => {
                const thickness = wanted.get(type.id);

                if (thickness === undefined) {
                    return type;
                }

                return {
                    ...type,
                    // Never thin a wall to meet a number: somebody drew that
                    // thickness for a reason the code does not know about.
                    thickness: Math.max(type.thickness, thickness),
                    construction: type.construction ?? 'wood',
                };
            }),
        },
        upgraded: failing.map((check) => check.type.name),
        needsInsulation,
    };
}

/** Resistance as it would be quoted: RSI in metric, R-value in imperial. */
export function formatResistance(rsi: number, units: Units): string {
    return units === 'imperial'
        ? `R-${(rsi * R_PER_RSI).toFixed(1)}`
        : `RSI ${rsi.toFixed(2)}`;
}
