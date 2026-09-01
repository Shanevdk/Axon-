/**
 * The bill of materials.
 *
 * Everything drawn is measured and turned into the things you would actually
 * buy: a wood wall becomes studs, plates, sheathing and board, a concrete one
 * becomes cubic metres of pour, formwork and rebar. What a thing is built of
 * comes from `constructionOf()` in model.ts, so the same wall reads as timber
 * or as concrete depending on its type.
 *
 * Every quantity is held in the document's own base units — millimetres,
 * square millimetres, cubic millimetres, or a plain count — and only
 * `formatQuantity()` knows about metres and feet. Nothing here rounds; the
 * table is the last honest place to do that.
 *
 * Only what is being built is counted. Existing work is already standing and
 * demolished work is leaving, so both are left out, the same way a phase
 * filter leaves them out of a drawing.
 */

import { distance, polygonArea, polygonPerimeter } from '@/lib/cad/geometry';
import {
    constructionOf,
    openingSize,
    wallLayers,
    wallTypeOf,
} from '@/lib/cad/model';
import { expandFootprint, stairSteps } from '@/lib/cad/solids';
import type {
    BeamElement,
    BraceElement,
    CableTrayElement,
    CadDocument,
    CadElement,
    CeilingElement,
    ColumnElement,
    DuctElement,
    FixtureElement,
    FloorElement,
    FootingElement,
    MeshElement,
    OpeningElement,
    PadElement,
    PipeElement,
    RailingElement,
    RampElement,
    RoofElement,
    StairElement,
    ToposurfaceElement,
    Units,
    WallElement,
} from '@/lib/cad/types';
import { formatArea, formatVolume } from '@/lib/cad/units';

/* ------------------------------------------------------------------ shape */

/** How a material is bought: by the piece, the metre, the sheet or the load. */
export type TakeoffUnit = 'each' | 'length' | 'area' | 'volume';

/** The trade the line belongs to, which is how an estimator reads a BOM. */
export type TakeoffSection =
    | 'concrete'
    | 'framing'
    | 'roofing'
    | 'envelope'
    | 'openings'
    | 'insulation'
    | 'electrical'
    | 'plumbing'
    | 'hvac'
    | 'finishes'
    | 'hardware'
    | 'site';

export const SECTION_LABELS: Record<TakeoffSection, string> = {
    concrete: 'Foundation & Structure',
    framing: 'Framing',
    roofing: 'Roofing',
    envelope: 'Exterior',
    openings: 'Windows & Doors',
    insulation: 'Insulation & Air Sealing',
    electrical: 'Electrical',
    plumbing: 'Plumbing',
    hvac: 'HVAC',
    finishes: 'Interior Finishes',
    hardware: 'Hardware & Fasteners',
    site: 'Site',
};

/** The order the sections are printed in, following the trades on site. */
export const SECTION_ORDER: TakeoffSection[] = [
    'concrete',
    'framing',
    'roofing',
    'envelope',
    'openings',
    'insulation',
    'electrical',
    'plumbing',
    'hvac',
    'finishes',
    'hardware',
    'site',
];

export type TakeoffLine = {
    /** Stable identity: section, material and unit together. */
    key: string;
    section: TakeoffSection;
    /** What to buy, sized and named the way a supplier lists it. */
    material: string;
    unit: TakeoffUnit;
    /**
     * The measured amount, before waste, in the document's base units:
     * a count, millimetres, square millimetres or cubic millimetres.
     */
    quantity: number;
    /** How many drawn elements fed this line. */
    from: number;
    /**
     * Cutting allowance, as a fraction. Sheet goods and sawn lengths carry
     * one; anything counted by the piece does not.
     */
    waste: number;
};

export type Takeoff = {
    lines: TakeoffLine[];
    /** Elements that produced at least one line. */
    counted: number;
    /**
     * Elements measured but not turned into materials — imported geometry,
     * whose contents are unknown to us.
     */
    unknown: number;
};

/* --------------------------------------------------------------- lumber */

type LumberSize = {
    /** Actual depth of the section, in millimetres. */
    depth: number;
    metric: string;
    imperial: string;
};

/**
 * Sawn softwood as it is actually sold: the metric names are the real milled
 * sizes, the imperial ones the nominal names everyone still says out loud.
 */
const LUMBER: LumberSize[] = [
    { depth: 89, metric: '38 × 89', imperial: '2x4' },
    { depth: 140, metric: '38 × 140', imperial: '2x6' },
    { depth: 184, metric: '38 × 184', imperial: '2x8' },
    { depth: 235, metric: '38 × 235', imperial: '2x10' },
    { depth: 286, metric: '38 × 286', imperial: '2x12' },
];

/**
 * The stock nearest the depth asked for.
 *
 * Nearest rather than next-size-up, because a wall is never exactly its
 * studs: a 92mm partition is 89mm of timber and a skim of board, and it is
 * 2x4 you order for it.
 */
function lumberFor(depth: number): LumberSize {
    return LUMBER.reduce((best, size) =>
        Math.abs(size.depth - depth) < Math.abs(best.depth - depth)
            ? size
            : best,
    );
}

export function lumberName(depth: number, units: Units): string {
    const size = lumberFor(depth);

    return units === 'imperial' ? size.imperial : size.metric;
}

/** Thickness of one plate, and so of one stud's width. */
export const PLATE = 38;

/**
 * The deepest a stud is taken to be, whatever the wall measures.
 *
 * A wall type carries one thickness for the whole build-up, so a brick
 * veneer wall reads as 300mm of "core" when it is really 2x6 studs with a
 * cavity and a skin of brick in front of them. Houses are framed in 2x4 and
 * 2x6; capping here calls those right, at the cost of under-calling a
 * genuinely deep-stud wall — which is the rarer of the two mistakes, and one
 * the Built Of field on the wall can correct.
 */
const MAX_STUD_DEPTH = 140;

/**
 * Framing centres: sixteen inches where the drawing is in feet, four hundred
 * millimetres where it is not.
 */
export function studSpacing(units: Units): number {
    return units === 'imperial' ? 406.4 : 400;
}

/** Extra studs each opening costs: two kings, two jacks, and cripples. */
const STUDS_PER_OPENING = 3;

/** Rebar centres assumed when reinforcement is counted, each way. */
const REBAR_SPACING = 400;

/** Spacing of railing posts. */
const POST_SPACING = 1200;

/* ----------------------------------------------------- rules of thumb */

/*
 * What follows are allowances, not designs.
 *
 * Nothing in the model says where a socket goes or how long a run of PEX
 * is, and pretending otherwise would be worse than saying nothing. These
 * are the ratios an estimator carries in their head to price a house before
 * the services are drawn — enough to order against and to see the shape of
 * the job, and to be replaced line by line as the real drawings arrive.
 *
 * They are all stated per square metre or per room so they scale with the
 * building rather than being a fixed guess about one.
 */

/** Anchor bolts through a sill plate, at centres. */
const ANCHOR_BOLT_SPACING = 1800;

/** One socket outlet per this much floor area, in square millimetres. */
const AREA_PER_OUTLET = 12e6;

/** Cable to each point, there and back, with slack — a run's worth. */
const CABLE_PER_POINT = 14_000;

/** Supply pipe to a fixture and back to the manifold. */
const SUPPLY_PER_FIXTURE = 12_000;

/** Waste and vent pipe for one fixture. */
const DRAIN_PER_FIXTURE = 6000;

/** One warm air register per this much floor area. */
const AREA_PER_REGISTER = 20e6;

/** Attic ventilation at the usual 1:300 of the ceiling below. */
const VENT_RATIO = 300;

/** What one roof vent is worth in free area, in square millimetres. */
const VENT_FREE_AREA = 0.03e6;

/** A downspout for this much gutter. */
const GUTTER_PER_DOWNSPOUT = 12_000;

/** Nails into each stud, top and bottom. */
const NAILS_PER_STUD = 4;

/** Sheathing nails per square metre of sheet, at 150mm edges and 300 field. */
const SHEATHING_NAILS_PER_SQM = 26;

/** Drywall screws per square metre of board. */
const DRYWALL_SCREWS_PER_SQM = 30;

/** Subfloor screws per square metre. */
const SUBFLOOR_SCREWS_PER_SQM = 20;

/** A tube of adhesive per this much subfloor. */
const SQM_PER_ADHESIVE_TUBE = 12;

/** A roll of joint tape per this much board. */
const SQM_PER_TAPE_ROLL = 30;

/** Joint compound, in litres per square metre of board. */
const COMPOUND_PER_SQM = 0.5;

/** Paint covers this much wall per litre, per coat. */
const PAINT_COVERAGE = 11;

/** A tube of sealant per this much joint. */
const METRES_PER_SEALANT_TUBE = 6;

/**
 * The materials other lines are worked out from.
 *
 * Screws follow board, nails follow sheathing, paint follows what it is
 * painted on. Naming them once means the second pass can find them by key
 * rather than by matching on strings that a rewording would quietly break.
 */
const NAMED = {
    gypsum: 'Gypsum board 12.7mm',
    sheathing: 'Sheathing 11mm OSB',
    roofSheathing: 'Roof sheathing 11mm OSB',
    subfloor: 'Subfloor 18mm T&G',
    cladding: 'Cladding',
    sealant: 'Sealant and caulking',
    stud: 'stud',
} as const;

/* ------------------------------------------------------------- gathering */

type Accumulator = Map<string, TakeoffLine>;

function add(
    into: Accumulator,
    section: TakeoffSection,
    material: string,
    unit: TakeoffUnit,
    quantity: number,
    waste = 0,
): void {
    if (quantity <= 0) {
        return;
    }

    const key = `${section}|${material}|${unit}`;
    const line = into.get(key);

    if (line) {
        line.quantity += quantity;
        line.from += 1;

        return;
    }

    into.set(key, { key, section, material, unit, quantity, from: 1, waste });
}

/**
 * Rebar run through a face at the assumed centres, both ways: a bay every
 * 400mm in each direction, so a square metre takes five metres of bar.
 */
function rebarLength(faceArea: number): number {
    return (faceArea / REBAR_SPACING) * 2;
}

/**
 * Whether this level is the one standing on the ground, which is what
 * decides that a wall is bolted to a foundation rather than nailed to a
 * floor. Lowest by elevation, not by the order the levels were added.
 */
function isLowestLevel(document: CadDocument, level: string): boolean {
    const lowest = document.levels.reduce(
        (found, candidate) =>
            found === null || candidate.elevation < found.elevation
                ? candidate
                : found,
        null as (typeof document.levels)[number] | null,
    );

    return lowest?.id === level;
}

/* ------------------------------------------------------------------ walls */

function takeOffWall(
    document: CadDocument,
    wall: WallElement,
    openings: OpeningElement[],
    into: Accumulator,
): void {
    const length = distance(wall.a, wall.b);
    const height = wall.height;

    if (length < 1 || height < 1) {
        return;
    }

    const type = wallTypeOf(document, wall.typeId);
    const construction = constructionOf(document, wall);
    const face = length * height;
    const holes = openings.reduce((total, opening) => {
        const size = openingSize(document, opening);

        return total + size.width * size.height;
    }, 0);
    const net = Math.max(face - holes, 0);
    const exterior = type.function === 'exterior';
    const units = document.units;
    const onFoundation = isLowestLevel(document, wall.level);

    if (construction === 'glazed') {
        // A curtain wall is its glass and the aluminium holding it up.
        const modules = Math.max(Math.round(length / 1200), 1);

        add(into, 'envelope', 'Curtain wall glazing', 'area', face, 0.05);
        add(
            into,
            'envelope',
            'Curtain wall mullion',
            'length',
            (modules + 1) * height + length * 2,
            0.05,
        );

        return;
    }

    if (construction === 'concrete') {
        add(
            into,
            'concrete',
            'Cast-in-place concrete',
            'volume',
            net * type.thickness,
        );
        add(into, 'concrete', 'Wall formwork', 'area', net * 2, 0.1);
        add(into, 'concrete', 'Rebar 15M', 'length', rebarLength(net));

        return;
    }

    if (construction === 'masonry') {
        add(
            into,
            'framing',
            'Concrete block 190 × 190 × 390',
            'area',
            net,
            0.05,
        );
        add(into, 'framing', 'Mortar', 'volume', net * 12, 0.1);
        add(into, 'concrete', 'Rebar 15M', 'length', rebarLength(net) / 2);

        return;
    }

    if (construction === 'steel') {
        add(
            into,
            'framing',
            'Steel stud 92mm',
            'length',
            studCount(length, openings.length, units) * height,
            0.05,
        );
        add(into, 'framing', 'Steel track', 'length', length * 2, 0.05);
        add(
            into,
            'finishes',
            'Gypsum board 12.7mm',
            'area',
            net * (exterior ? 1 : 2),
            0.1,
        );

        return;
    }

    // Wood framing: the studs, the plates holding them, and the skins.
    const core = Math.min(wallLayers(type).core, MAX_STUD_DEPTH);
    const stud = lumberName(core, units);
    // A stud is the storey height less the bottom plate and doubled top plate.
    const studLength = Math.max(height - PLATE * 3, 0);

    add(
        into,
        'framing',
        `${stud} stud, ${Math.round(studLength)} long`,
        'each',
        studCount(length, openings.length, units),
    );
    // One bottom plate and a doubled top plate, the whole length of the wall.
    add(into, 'framing', `${stud} plate`, 'length', length * 3, 0.1);

    openings.forEach((opening) => {
        const size = openingSize(document, opening);

        // A header carries over the opening and lands on a jack each side,
        // doubled up the way an opening in a bearing wall is built.
        add(
            into,
            'framing',
            `${lumberName(184, units)} header`,
            'length',
            (size.width + 200) * 2,
            0.1,
        );
    });

    // A wall standing on the foundation is bolted down to it through a
    // treated plate. One above it lands on the floor below and is not.
    if (onFoundation) {
        add(into, 'concrete', 'Sill plate, treated', 'length', length, 0.1);
        add(into, 'concrete', 'Sill gasket', 'length', length, 0.1);
        add(
            into,
            'hardware',
            'Anchor bolt with washer and nut',
            'each',
            Math.max(Math.ceil(length / ANCHOR_BOLT_SPACING), 2),
        );
    }

    if (exterior) {
        add(into, 'envelope', NAMED.sheathing, 'area', net, 0.1);
        add(into, 'envelope', 'Building wrap', 'area', net, 0.15);
        add(into, 'envelope', NAMED.cladding, 'area', net, 0.1);
        add(
            into,
            'insulation',
            `Batt insulation ${Math.round(core)}mm`,
            'area',
            net,
            0.05,
        );
        // The inside face of an outside wall gets the air and vapour control
        // layer; a wall between two rooms has nothing to keep apart.
        add(into, 'insulation', 'Air and vapour barrier', 'area', net, 0.15);

        // Trim round the openings and down the corners of the cladding.
        const reveals = openings.reduce((total, opening) => {
            const size = openingSize(document, opening);

            return total + (size.width + size.height) * 2;
        }, 0);

        add(into, 'envelope', 'Exterior trim', 'length', reveals + height * 2, 0.1);
        add(into, 'insulation', NAMED.sealant, 'length', reveals + length, 0.1);
    }

    const finishedSides = exterior ? 1 : 2;

    add(into, 'finishes', NAMED.gypsum, 'area', net * finishedSides, 0.1);

    // Baseboard runs the finished sides, less the doorways it steps around.
    const doorways = openings.reduce(
        (total, opening) =>
            opening.kind === 'door'
                ? total + openingSize(document, opening).width
                : total,
        0,
    );

    add(
        into,
        'finishes',
        'Baseboard',
        'length',
        Math.max(length * finishedSides - doorways, 0),
        0.1,
    );
}

/**
 * How many studs a wall takes: one every bay, one to close the end, and three
 * more around each opening for its kings, jacks and cripples.
 */
export function studCount(
    length: number,
    openings: number,
    units: Units,
): number {
    return (
        Math.floor(length / studSpacing(units)) +
        1 +
        openings * STUDS_PER_OPENING
    );
}

/* -------------------------------------------------------------- flat work */

function takeOffFloor(
    document: CadDocument,
    floor: FloorElement,
    into: Accumulator,
): void {
    const area = polygonArea(floor.points);

    if (area <= 0) {
        return;
    }

    const perimeter = polygonPerimeter(floor.points);

    if (constructionOf(document, floor) === 'concrete') {
        add(
            into,
            'concrete',
            'Cast-in-place concrete',
            'volume',
            area * floor.thickness,
        );
        add(into, 'concrete', 'Rebar 15M', 'length', rebarLength(area));
        add(
            into,
            'concrete',
            'Edge formwork',
            'area',
            perimeter * floor.thickness,
            0.1,
        );
        add(into, 'concrete', 'Under-slab vapour barrier', 'area', area, 0.15);

        return;
    }

    const units = document.units;
    const joist = lumberName(floor.thickness, units);

    // Joists at centres cover the area: every bay across it takes its length
    // in joist, so the run is simply the area divided by the spacing.
    add(
        into,
        'framing',
        `${joist} joist`,
        'length',
        area / studSpacing(units),
        0.1,
    );
    add(into, 'framing', `${joist} rim joist`, 'length', perimeter, 0.1);
    add(into, 'framing', NAMED.subfloor, 'area', area, 0.1);

    // A joist lands on the rim at every bay round the edge, and each landing
    // takes a hanger.
    add(
        into,
        'hardware',
        'Joist hanger',
        'each',
        Math.ceil(perimeter / studSpacing(units)),
    );

    // A floor above the ground is hung off the wall it meets.
    if (!isLowestLevel(document, floor.level)) {
        add(into, 'framing', `${joist} ledger board`, 'length', perimeter, 0.1);
    }

    add(into, 'finishes', 'Floor underlayment', 'area', area, 0.1);
    add(into, 'finishes', 'Floor finish', 'area', area, 0.1);
}

function takeOffCeiling(
    document: CadDocument,
    ceiling: CeilingElement,
    into: Accumulator,
): void {
    const area = polygonArea(ceiling.points);

    if (area <= 0) {
        return;
    }

    add(into, 'finishes', 'Gypsum board 12.7mm', 'area', area, 0.1);
    add(
        into,
        'framing',
        'Ceiling furring',
        'length',
        area / studSpacing(document.units),
        0.1,
    );
}

function takeOffRoof(
    document: CadDocument,
    roof: RoofElement,
    into: Accumulator,
): void {
    if (roof.points.length < 3) {
        return;
    }

    // The eave line is what is actually built, overhang and all.
    const eave = expandFootprint(roof.points, roof.overhang);
    const footprint = polygonArea(eave);

    if (footprint <= 0) {
        return;
    }

    // A pitched plane covers more than the ground beneath it.
    const pitch = Math.max(Math.cos((roof.slope * Math.PI) / 180), 0.1);
    const sloped = footprint / pitch;
    const units = document.units;

    const perimeter = polygonPerimeter(eave);
    const rafters = sloped / studSpacing(units);

    add(into, 'framing', `${lumberName(184, units)} rafter`, 'length', rafters, 0.1);

    // The ridge runs the long way across the roof. Taken from the footprint
    // rather than from a ridge line, because the model does not carry one:
    // it is the length of a rectangle of this area and this perimeter.
    add(
        into,
        'framing',
        `${lumberName(235, units)} ridge board`,
        'length',
        ridgeRun(footprint, perimeter),
        0.1,
    );

    add(into, 'roofing', NAMED.roofSheathing, 'area', sloped, 0.1);
    add(into, 'roofing', 'Roofing underlay', 'area', sloped, 0.15);
    add(into, 'roofing', 'Asphalt shingles', 'area', sloped, 0.1);
    add(
        into,
        'roofing',
        'Ridge cap shingles',
        'length',
        ridgeRun(footprint, perimeter),
        0.1,
    );
    // Drip edge round the whole roof; step and valley flashing is an
    // allowance against the eaves, since the model has no valleys in it.
    add(into, 'roofing', 'Drip edge flashing', 'length', perimeter, 0.1);
    add(into, 'roofing', 'Step and valley flashing', 'length', perimeter * 0.25, 0.1);
    add(into, 'roofing', 'Fascia', 'length', perimeter, 0.1);
    add(into, 'roofing', 'Soffit', 'area', perimeter * Math.max(roof.overhang, 1), 0.1);
    add(into, 'roofing', 'Gutter', 'length', perimeter, 0.05);
    add(
        into,
        'roofing',
        'Downspout',
        'each',
        Math.max(Math.ceil(perimeter / GUTTER_PER_DOWNSPOUT), 1),
    );

    // Attic ventilation at 1:300 of the ceiling below, half of it high and
    // half of it at the eaves.
    add(
        into,
        'roofing',
        'Roof vent',
        'each',
        Math.max(Math.ceil(footprint / VENT_RATIO / VENT_FREE_AREA), 1),
    );

    add(into, 'insulation', 'Attic insulation', 'area', footprint, 0.05);
    add(into, 'hardware', 'Hurricane tie', 'each', Math.ceil(rafters / 3000) * 2);
}

/**
 * How long the ridge is, for a roof the model only knows the outline of.
 *
 * Solving the rectangle with this area and this perimeter gives its two
 * sides; the ridge runs the difference between them, which is exact for a
 * plain hip and a fair allowance for anything else. A square plan comes out
 * at zero, which is right — that is a pyramid, and it has no ridge.
 */
function ridgeRun(area: number, perimeter: number): number {
    const half = perimeter / 2;
    const root = half * half - 4 * area;

    if (root <= 0) {
        return 0;
    }

    return Math.sqrt(root);
}

/* --------------------------------------------------------------- structure */

function takeOffColumn(
    document: CadDocument,
    column: ColumnElement,
    into: Accumulator,
): void {
    if (constructionOf(document, column) === 'concrete') {
        add(
            into,
            'concrete',
            'Cast-in-place concrete',
            'volume',
            column.size * column.size * column.height,
        );
        add(
            into,
            'concrete',
            'Column formwork',
            'area',
            column.size * 4 * column.height,
            0.1,
        );

        return;
    }

    add(
        into,
        'framing',
        `Post ${Math.round(column.size)} × ${Math.round(column.size)}`,
        'each',
        1,
    );
}

function takeOffBeam(
    document: CadDocument,
    beam: BeamElement,
    into: Accumulator,
): void {
    const length = distance(beam.a, beam.b);

    if (length < 1) {
        return;
    }

    const size = `${Math.round(beam.width)} × ${Math.round(beam.depth)}`;

    if (constructionOf(document, beam) === 'steel') {
        add(into, 'framing', `Steel beam ${size}`, 'length', length, 0.05);

        return;
    }

    add(into, 'framing', `Built-up beam ${size}`, 'length', length, 0.1);
}

function takeOffBrace(brace: BraceElement, into: Accumulator): void {
    const run = distance(brace.a, brace.b);
    // The member follows its slope, so it is longer than its plan run.
    const length = Math.hypot(run, brace.rise);

    add(
        into,
        'framing',
        `Steel brace ${Math.round(brace.width)}mm`,
        'length',
        length,
        0.05,
    );
}

function takeOffFooting(footing: FootingElement, into: Accumulator): void {
    add(
        into,
        'concrete',
        'Cast-in-place concrete',
        'volume',
        footing.width * footing.width * footing.depth,
    );
    add(
        into,
        'concrete',
        'Footing formwork',
        'area',
        footing.width * 4 * footing.depth,
        0.1,
    );
    add(
        into,
        'concrete',
        'Rebar 15M',
        'length',
        rebarLength(footing.width * footing.width),
    );
}

function takeOffPad(pad: PadElement, into: Accumulator): void {
    const area = polygonArea(pad.points);

    if (area <= 0) {
        return;
    }

    add(
        into,
        'concrete',
        'Cast-in-place concrete',
        'volume',
        area * pad.thickness,
    );
    add(into, 'concrete', 'Rebar 15M', 'length', rebarLength(area));
    add(into, 'site', 'Granular fill', 'volume', area * 150);
}

/* ------------------------------------------------------------ circulation */

function takeOffStair(
    document: CadDocument,
    stair: StairElement,
    into: Accumulator,
): void {
    const run = distance(stair.a, stair.b);

    if (run < 100) {
        return;
    }

    const { count } = stairSteps(stair);
    const sloped = Math.hypot(run, stair.rise);

    add(into, 'framing', 'Stair tread', 'each', count);
    add(into, 'framing', 'Stair riser', 'each', count);
    // Two outer stringers and one more down the middle.
    add(
        into,
        'framing',
        `${lumberName(286, document.units)} stringer`,
        'length',
        sloped * 3,
        0.1,
    );
}

function takeOffRamp(ramp: RampElement, into: Accumulator): void {
    const run = distance(ramp.a, ramp.b);

    if (run < 100) {
        return;
    }

    add(into, 'framing', 'Ramp decking', 'area', run * ramp.width, 0.1);
}

function takeOffRailing(railing: RailingElement, into: Accumulator): void {
    const length = distance(railing.a, railing.b);

    if (length < 1) {
        return;
    }

    add(
        into,
        'framing',
        'Railing post',
        'each',
        Math.max(Math.round(length / POST_SPACING), 1) + 1,
    );
    // A rail top and bottom, with the infill between them.
    add(into, 'framing', 'Handrail', 'length', length * 2, 0.1);
    add(
        into,
        'framing',
        'Railing infill',
        'area',
        length * railing.height,
        0.1,
    );
}

/* ---------------------------------------------------------------- services */

function takeOffDuct(duct: DuctElement, into: Accumulator): void {
    const length = distance(duct.a, duct.b);

    if (length < 1) {
        return;
    }

    // Sheet metal is bought by the area wrapped around the run.
    const depth = Math.max(duct.width / 2, 150);
    const girth = (duct.width + depth) * 2;

    add(
        into,
        'hvac',
        `Ductwork ${Math.round(duct.width)}mm`,
        'length',
        length,
        0.1,
    );
    add(into, 'hvac', 'Duct sheet metal', 'area', girth * length, 0.15);
    add(into, 'hvac', 'Duct insulation', 'area', girth * length, 0.1);
}

function takeOffPipe(pipe: PipeElement, into: Accumulator): void {
    const length = distance(pipe.a, pipe.b);

    if (length < 1) {
        return;
    }

    add(
        into,
        'plumbing',
        `Pipe Ø${Math.round(pipe.diameter)} ${pipe.system}`,
        'length',
        length,
        0.1,
    );
}

function takeOffCableTray(tray: CableTrayElement, into: Accumulator): void {
    const length = distance(tray.a, tray.b);

    if (length < 1) {
        return;
    }

    add(
        into,
        'electrical',
        `Cable tray ${Math.round(tray.width)}mm`,
        'length',
        length,
        0.05,
    );
}

const FIXTURE_SECTIONS: Record<FixtureElement['category'], TakeoffSection> = {
    planting: 'site',
    parking: 'site',
    furniture: 'finishes',
    plumbing: 'plumbing',
    lighting: 'electrical',
    electrical: 'electrical',
    mechanical: 'hvac',
    airTerminal: 'hvac',
    sprinkler: 'plumbing',
};

function takeOffFixture(fixture: FixtureElement, into: Accumulator): void {
    add(into, FIXTURE_SECTIONS[fixture.category], fixture.name, 'each', 1);

    // A plumbing fixture is not just the thing on the wall: it is the pipe
    // that reaches it, the valves that isolate it and the trap under it.
    if (fixture.category === 'plumbing') {
        add(into, 'plumbing', 'PEX supply pipe', 'length', SUPPLY_PER_FIXTURE, 0.1);
        add(into, 'plumbing', 'DWV drain and vent pipe', 'length', DRAIN_PER_FIXTURE, 0.1);
        add(into, 'plumbing', 'Pipe fittings', 'each', 8);
        add(into, 'plumbing', 'Shutoff valve', 'each', 2);
        add(into, 'plumbing', 'P-trap', 'each', 1);
        add(into, 'plumbing', 'Tap set', 'each', 1);
    }
}

/* ----------------------------------------------------------- the services */

/**
 * The trades the drawing does not carry.
 *
 * A house needs a panel, a boiler and a socket in every room whether or not
 * anyone has drawn them, and leaving them off the bill would make it look
 * cheaper than the house is. These are worked out from the floor area and
 * the rooms, at the ratios above, and every line here is an allowance — the
 * moment a real service drawing exists, its elements are measured instead
 * and these should come off.
 */
function takeOffServices(document: CadDocument, into: Accumulator): void {
    const building = document.elements.filter(
        (element) => (element.phase ?? 'new') === 'new',
    );

    const area = building.reduce(
        (total, element) =>
            element.kind === 'floor'
                ? total + polygonArea(element.points)
                : total,
        0,
    );

    const rooms = building.filter((element) => element.kind === 'room').length;

    if (area <= 0 && rooms === 0) {
        return;
    }

    const levels = new Set(building.map((element) => element.level)).size;

    /* ------------------------------------------------------- electrical */

    const outlets = Math.max(Math.ceil(area / AREA_PER_OUTLET), rooms);
    // A switch at the way in, and a second one where a room has two ways in.
    const switches = Math.max(rooms * 2, 4);
    const lights = Math.max(rooms, 4);

    add(into, 'electrical', 'Distribution panel 200A', 'each', 1);
    add(into, 'electrical', 'Service entrance conduit and cable', 'length', 15_000, 0.1);
    // A circuit for every eight points, plus the fixed loads a house has.
    add(
        into,
        'electrical',
        'Breaker',
        'each',
        Math.ceil((outlets + switches + lights) / 8) + 8,
    );
    add(into, 'electrical', 'Socket outlet', 'each', outlets);
    add(into, 'electrical', 'Switch', 'each', switches);
    add(into, 'electrical', 'Light fitting', 'each', lights);
    add(into, 'electrical', 'Junction and device box', 'each', outlets + switches + lights);
    add(
        into,
        'electrical',
        'Romex cable 14/2',
        'length',
        (outlets + switches + lights) * CABLE_PER_POINT,
        0.1,
    );
    // One in every bedroom, one on each storey, and carbon monoxide with them.
    add(into, 'electrical', 'Smoke and CO alarm', 'each', Math.max(rooms, levels) + levels);

    /* --------------------------------------------------------- plumbing */

    // The pipework that follows each fixture is counted with the fixture; a
    // house has one of these however many fixtures hang off it.
    add(into, 'plumbing', 'Water heater', 'each', 1);
    add(into, 'plumbing', 'Main shutoff valve', 'each', 1);

    /* ------------------------------------------------------------- hvac */

    add(into, 'hvac', 'Furnace and air handler', 'each', 1);
    add(into, 'hvac', 'Condensing unit', 'each', 1);
    add(into, 'hvac', 'Refrigerant line set', 'length', 10_000, 0.1);
    add(into, 'hvac', 'Thermostat', 'each', 1);
    add(
        into,
        'hvac',
        'Register and grille',
        'each',
        Math.max(Math.ceil(area / AREA_PER_REGISTER), rooms),
    );
}

/* ------------------------------------------------------------------ ground */

function takeOffToposurface(topo: ToposurfaceElement, into: Accumulator): void {
    const area = polygonArea(topo.points);

    if (area <= 0) {
        return;
    }

    add(into, 'site', 'Site excavation', 'volume', area * topo.depth);
    add(into, 'site', 'Topsoil', 'area', area);
}

function takeOffOpening(
    document: CadDocument,
    opening: OpeningElement,
    into: Accumulator,
): void {
    const size = openingSize(document, opening);
    const host = document.elements.find(
        (element): element is WallElement =>
            element.kind === 'wall' && element.id === opening.host,
    );

    // An opening in an outside wall is a different thing to buy: it is
    // weathertight, it is sealed to the wrap, and if it is a door it is an
    // exterior door with a threshold under it.
    const exterior = host
        ? wallTypeOf(document, host.typeId).function === 'exterior'
        : false;

    // Head, jambs and sill, which is what a frame and its trim run to.
    const reveal = size.width * 2 + size.height * 2;

    if (opening.kind === 'door') {
        add(
            into,
            'openings',
            `${exterior ? 'Exterior' : 'Interior'} door ${Math.round(size.width)} × ${Math.round(size.height)}`,
            'each',
            1,
        );
        add(into, 'openings', 'Door frame set', 'each', 1);
        add(into, 'hardware', 'Butt hinge', 'each', exterior ? 3 : 2);
        add(
            into,
            'hardware',
            exterior ? 'Entry lockset and deadbolt' : 'Passage lockset',
            'each',
            1,
        );

        if (exterior) {
            add(into, 'openings', 'Door weatherstripping', 'length', reveal, 0.1);
            add(into, 'openings', 'Door threshold', 'length', size.width, 0.1);
        }
    } else {
        add(
            into,
            'openings',
            `Window ${Math.round(size.width)} × ${Math.round(size.height)}`,
            'each',
            1,
        );

        if (exterior) {
            add(into, 'openings', 'Window flashing tape', 'length', reveal, 0.15);
        }
    }

    add(into, 'finishes', 'Interior casing', 'length', reveal, 0.1);

    if (exterior) {
        add(into, 'insulation', NAMED.sealant, 'length', reveal, 0.1);
    }
}

/**
 * Imported geometry is somebody else's model: it is listed so it is not
 * silently missing from the sheet, but nothing here knows what it is made of.
 */
function takeOffMesh(mesh: MeshElement, into: Accumulator): void {
    add(into, 'finishes', `${mesh.name} (imported)`, 'each', 1);
}

/* -------------------------------------------------------- what follows on */

/**
 * The things bought because of other things.
 *
 * Screws follow board, nails follow sheathing, paint follows what it is
 * painted on. None of it is drawn and none of it can be measured off the
 * model directly — it is arithmetic on what has already been counted, which
 * is why it runs last, over the finished list rather than element by
 * element.
 */
function takeOffConsumables(into: Accumulator): void {
    /** Square metres gathered under a material name, whatever section it sat in. */
    const areaOf = (...materials: string[]): number =>
        [...into.values()]
            .filter(
                (line) => line.unit === 'area' && materials.includes(line.material),
            )
            .reduce((total, line) => total + line.quantity, 0) / 1e6;

    const board = areaOf(NAMED.gypsum);
    const sheathing = areaOf(NAMED.sheathing, NAMED.roofSheathing);
    const subfloor = areaOf(NAMED.subfloor);
    const cladding = areaOf(NAMED.cladding);

    const studs = [...into.values()]
        .filter(
            (line) =>
                line.section === 'framing' &&
                line.unit === 'each' &&
                line.material.includes(NAMED.stud),
        )
        .reduce((total, line) => total + line.quantity, 0);

    const sealant =
        [...into.values()]
            .filter((line) => line.material === NAMED.sealant)
            .reduce((total, line) => total + line.quantity, 0) / 1000;

    /* -------------------------------------------------------- fasteners */

    add(into, 'hardware', 'Framing nail 90mm', 'each', studs * NAILS_PER_STUD);
    add(
        into,
        'hardware',
        'Sheathing nail 60mm',
        'each',
        sheathing * SHEATHING_NAILS_PER_SQM,
    );
    add(
        into,
        'hardware',
        'Drywall screw 32mm',
        'each',
        board * DRYWALL_SCREWS_PER_SQM,
    );
    add(
        into,
        'hardware',
        'Subfloor screw 60mm',
        'each',
        subfloor * SUBFLOOR_SCREWS_PER_SQM,
    );
    add(
        into,
        'hardware',
        'Construction adhesive, tube',
        'each',
        Math.ceil(subfloor / SQM_PER_ADHESIVE_TUBE),
    );
    add(
        into,
        'hardware',
        'Sealant, tube',
        'each',
        Math.ceil(sealant / METRES_PER_SEALANT_TUBE),
    );

    /* --------------------------------------------------------- finishes */

    add(
        into,
        'finishes',
        'Joint tape, roll',
        'each',
        Math.ceil(board / SQM_PER_TAPE_ROLL),
    );
    add(into, 'finishes', 'Joint compound, litres', 'each', board * COMPOUND_PER_SQM);
    // A coat of primer and two of paint, at what a litre covers.
    add(into, 'finishes', 'Interior primer, litres', 'each', board / PAINT_COVERAGE);
    add(
        into,
        'finishes',
        'Interior paint, litres',
        'each',
        (board * 2) / PAINT_COVERAGE,
    );
    add(
        into,
        'envelope',
        'Exterior paint, litres',
        'each',
        (cladding * 2) / PAINT_COVERAGE,
    );
}

/* -------------------------------------------------------------------- main */

/**
 * Measure a whole model into the things it is built from.
 */
export function takeOff(document: CadDocument): Takeoff {
    const into: Accumulator = new Map();
    const openingsByHost = new Map<string, OpeningElement[]>();
    let counted = 0;
    let unknown = 0;

    // Only new work is bought. What is already standing, or on its way out,
    // is not on anybody's order.
    const building = document.elements.filter(
        (element) => (element.phase ?? 'new') === 'new',
    );

    building.forEach((element) => {
        if (element.kind !== 'door' && element.kind !== 'window') {
            return;
        }

        const held = openingsByHost.get(element.host) ?? [];
        held.push(element);
        openingsByHost.set(element.host, held);
    });

    building.forEach((element) => {
        const before = measured(into);

        measure(document, element, openingsByHost, into);

        // An element counts once it has actually added something to buy.
        if (measured(into) !== before) {
            counted += 1;
        }

        if (element.kind === 'mesh') {
            unknown += 1;
        }
    });

    // The trades nobody drew, then the things bought because of everything
    // above. Both read the whole building, so both come after it.
    takeOffServices(document, into);
    takeOffConsumables(into);

    const lines = [...into.values()].sort(
        (a, b) =>
            SECTION_ORDER.indexOf(a.section) -
                SECTION_ORDER.indexOf(b.section) ||
            a.material.localeCompare(b.material),
    );

    return { lines, counted, unknown };
}

/**
 * A running total of everything gathered so far, used only to notice that an
 * element added work. Summing the quantities catches the case a line already
 * existed and simply grew.
 */
function measured(into: Accumulator): number {
    let sum = 0;

    into.forEach((line) => {
        sum += line.quantity;
    });

    return sum;
}

function measure(
    document: CadDocument,
    element: CadElement,
    openingsByHost: Map<string, OpeningElement[]>,
    into: Accumulator,
): void {
    switch (element.kind) {
        case 'wall':
            takeOffWall(
                document,
                element,
                openingsByHost.get(element.id) ?? [],
                into,
            );
            break;
        case 'door':
        case 'window':
            takeOffOpening(document, element, into);
            break;
        case 'floor':
            takeOffFloor(document, element, into);
            break;
        case 'ceiling':
            takeOffCeiling(document, element, into);
            break;
        case 'roof':
            takeOffRoof(document, element, into);
            break;
        case 'column':
            takeOffColumn(document, element, into);
            break;
        case 'beam':
            takeOffBeam(document, element, into);
            break;
        case 'brace':
            takeOffBrace(element, into);
            break;
        case 'footing':
            takeOffFooting(element, into);
            break;
        case 'pad':
            takeOffPad(element, into);
            break;
        case 'stair':
            takeOffStair(document, element, into);
            break;
        case 'ramp':
            takeOffRamp(element, into);
            break;
        case 'railing':
            takeOffRailing(element, into);
            break;
        case 'duct':
            takeOffDuct(element, into);
            break;
        case 'pipe':
            takeOffPipe(element, into);
            break;
        case 'cableTray':
            takeOffCableTray(element, into);
            break;
        case 'fixture':
            takeOffFixture(element, into);
            break;
        case 'toposurface':
            takeOffToposurface(element, into);
            break;
        case 'mesh':
            takeOffMesh(element, into);
            break;
        default:
            // Annotation, datum and view marks are drawn, not built.
            break;
    }
}

/* ------------------------------------------------------------- presenting */

/**
 * A quantity as it should be ordered: pieces counted whole, and lengths,
 * areas and volumes in whatever the drawing is drawn in.
 */
export function formatQuantity(
    quantity: number,
    unit: TakeoffUnit,
    units: Units,
): string {
    switch (unit) {
        case 'each':
            // You cannot buy nine tenths of a stud.
            return Math.ceil(quantity - 1e-9).toLocaleString('en-CA');
        case 'length':
            return formatRun(quantity, units);
        case 'area':
            return formatArea(quantity, units);
        case 'volume':
            return formatVolume(quantity, units);
    }
}

/**
 * A run of material, in the length a supplier quotes: metres, or feet where
 * the drawing is imperial. Millimetres would be unreadable at this scale.
 */
export function formatRun(millimetres: number, units: Units): string {
    if (units === 'imperial') {
        return `${(millimetres / 304.8).toFixed(1)} ft`;
    }

    return `${(millimetres / 1000).toFixed(1)} m`;
}

/** The amount to actually order: the measured quantity plus its waste. */
export function orderQuantity(line: TakeoffLine): number {
    return line.quantity * (1 + line.waste);
}

/**
 * The bill as a spreadsheet, for sending to whoever is pricing the job.
 *
 * Quantities are written both as they read on screen and as bare numbers in
 * the base unit, so a estimator can sort and multiply without unpicking any
 * formatting.
 */
export function takeoffCsv(takeoff: Takeoff, units: Units): string {
    const header = [
        'Section',
        'Material',
        'Unit',
        'Quantity',
        'Waste %',
        'Order',
        'Order (raw)',
        'From elements',
    ];

    const rows = takeoff.lines.map((line) => [
        SECTION_LABELS[line.section],
        line.material,
        UNIT_LABELS[line.unit],
        formatQuantity(line.quantity, line.unit, units),
        String(Math.round(line.waste * 100)),
        formatQuantity(orderQuantity(line), line.unit, units),
        rawQuantity(orderQuantity(line), line.unit, units).toFixed(3),
        String(line.from),
    ]);

    return [header, ...rows]
        .map((row) => row.map(escapeCsv).join(','))
        .join('\n');
}

export const UNIT_LABELS: Record<TakeoffUnit, string> = {
    each: 'each',
    length: 'length',
    area: 'area',
    volume: 'volume',
};

/**
 * The bare number behind a formatted quantity, in the unit the sheet shows:
 * pieces, metres or feet, square metres or square feet, cubic metres or yards.
 */
function rawQuantity(
    quantity: number,
    unit: TakeoffUnit,
    units: Units,
): number {
    const imperial = units === 'imperial';

    switch (unit) {
        case 'each':
            return Math.ceil(quantity - 1e-9);
        case 'length':
            return imperial ? quantity / 304.8 : quantity / 1000;
        case 'area':
            return imperial ? quantity / 92903.04 : quantity / 1_000_000;
        case 'volume':
            return imperial ? quantity / 764554857.984 : quantity / 1e9;
    }
}

function escapeCsv(value: string): string {
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
