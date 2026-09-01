import { describe, expect, it } from 'vitest';
import { constructionOf, wallConstruction } from '@/lib/cad/model';
import {
    formatQuantity,
    orderQuantity,
    studCount,
    takeOff,
    takeoffCsv,
} from '@/lib/cad/takeoff';
import type { TakeoffLine } from '@/lib/cad/takeoff';
import type {
    CadDocument,
    CadElement,
    FloorElement,
    FootingElement,
    WallElement,
    WallType,
} from '@/lib/cad/types';

function baseDocument(overrides: Partial<CadDocument> = {}): CadDocument {
    return {
        version: 1,
        units: 'metric',
        levels: [{ id: 'level-1', name: 'Level 1', elevation: 0 }],
        wallTypes: [
            {
                id: 'stud-140',
                name: 'Exterior - Stud and Sheathing',
                thickness: 200,
                function: 'exterior',
                construction: 'wood',
            },
            {
                id: 'partition',
                name: 'Interior - 92mm Partition',
                thickness: 92,
                function: 'interior',
                construction: 'wood',
            },
            {
                id: 'concrete-300',
                name: 'Exterior - 300 Concrete',
                thickness: 300,
                function: 'exterior',
                construction: 'concrete',
            },
        ],
        doorTypes: [
            {
                id: 'door-900',
                name: 'Single 900',
                width: 900,
                height: 2100,
                leaves: 1,
            },
        ],
        windowTypes: [
            {
                id: 'win-1200',
                name: 'Fixed 1200',
                width: 1200,
                height: 1200,
                sillHeight: 900,
            },
        ],
        elements: [],
        viewSettings: {},
        ...overrides,
    };
}

function wall(
    typeId: string,
    length: number,
    overrides: Partial<WallElement> = {},
): WallElement {
    return {
        id: `wall-${typeId}-${length}`,
        kind: 'wall',
        level: 'level-1',
        typeId,
        a: { x: 0, y: 0 },
        b: { x: length, y: 0 },
        height: 2400,
        baseOffset: 0,
        locationLine: 'center',
        ...overrides,
    };
}

/** The one line a material should have, or a helpful failure. */
function line(document: CadDocument, material: string): TakeoffLine {
    const found = takeOff(document).lines.find(
        (item) => item.material === material,
    );

    if (!found) {
        throw new Error(
            `No "${material}" line. Got: ${takeOff(document)
                .lines.map((item) => item.material)
                .join(', ')}`,
        );
    }

    return found;
}

describe('what things are made of', () => {
    it('believes the type before it measures it', () => {
        const brickOnStud: WallType = {
            id: 'ext-brick',
            name: 'Exterior - Brick on Stud',
            thickness: 302,
            function: 'exterior',
        };

        // 302mm is thicker than most concrete, but the name says it is a
        // stud wall wearing a brick coat — and it is studs you buy.
        expect(wallConstruction(brickOnStud)).toBe('wood');

        expect(
            wallConstruction({
                id: 'c',
                name: 'Exterior - 300 Concrete',
                thickness: 300,
                function: 'exterior',
            }),
        ).toBe('concrete');

        // Only with nothing in the name does thickness get a say.
        expect(
            wallConstruction({
                id: 'x',
                name: 'Type A',
                thickness: 300,
                function: 'exterior',
            }),
        ).toBe('concrete');
        expect(
            wallConstruction({
                id: 'y',
                name: 'Type B',
                thickness: 140,
                function: 'exterior',
            }),
        ).toBe('wood');
    });

    it('lets one element depart from its type', () => {
        const document = baseDocument();
        const framed = wall('stud-140', 5000);
        const poured: WallElement = { ...framed, construction: 'concrete' };

        expect(constructionOf(document, framed)).toBe('wood');
        expect(constructionOf(document, poured)).toBe('concrete');
    });

    it('reads a curtain wall as glass whatever it is called', () => {
        expect(
            wallConstruction({
                id: 'cw',
                name: 'Type C',
                thickness: 150,
                function: 'curtain',
            }),
        ).toBe('glazed');
    });
});

describe('framing a wall', () => {
    it('studs a wall at centres, and closes the end', () => {
        // 4000mm at 400 centres: ten bays, and a stud to finish.
        expect(studCount(4000, 0, 'metric')).toBe(11);
        // Sixteen inch centres where the drawing is in feet.
        expect(studCount(4000, 0, 'imperial')).toBe(10);
        // Each opening brings its kings, jacks and cripples.
        expect(studCount(4000, 2, 'metric')).toBe(17);
    });

    it('counts studs, plates and skins for a wood wall', () => {
        const document = baseDocument({ elements: [wall('stud-140', 4000)] });

        const studs = line(document, '38 × 140 stud, 2286 long');

        expect(studs.unit).toBe('each');
        expect(studs.quantity).toBe(11);

        // A bottom plate and a doubled top plate: three passes of the wall.
        expect(line(document, '38 × 140 plate').quantity).toBe(12_000);

        // 4000 × 2400 of exterior wall to sheathe, wrap, clad and insulate.
        expect(line(document, 'Sheathing 11mm OSB').quantity).toBe(9_600_000);
        expect(line(document, 'Building wrap').quantity).toBe(9_600_000);
        // One face of board inside; the other side is the weather.
        expect(line(document, 'Gypsum board 12.7mm').quantity).toBe(9_600_000);
    });

    it('boards both faces of an interior wall and leaves it bare outside', () => {
        const document = baseDocument({ elements: [wall('partition', 4000)] });
        const materials = takeOff(document).lines.map((item) => item.material);

        expect(line(document, 'Gypsum board 12.7mm').quantity).toBe(
            2 * 4000 * 2400,
        );
        expect(materials).not.toContain('Cladding');
        expect(materials).not.toContain('Sheathing 11mm OSB');
    });

    it('takes the openings out of the skins and pays for their headers', () => {
        const opening: CadElement = {
            id: 'door-1',
            kind: 'door',
            level: 'level-1',
            typeId: 'door-900',
            host: 'wall-stud-140-4000',
            t: 0.5,
            flipFace: false,
            flipHand: false,
        };
        const document = baseDocument({
            elements: [wall('stud-140', 4000), opening],
        });

        // 4000 × 2400 less the 900 × 2100 hole.
        expect(line(document, 'Sheathing 11mm OSB').quantity).toBe(
            4000 * 2400 - 900 * 2100,
        );

        // Three more studs around it, and a doubled header over it.
        expect(line(document, '38 × 140 stud, 2286 long').quantity).toBe(14);
        expect(line(document, '38 × 184 header').quantity).toBe(
            (900 + 200) * 2,
        );

        // And the door itself is on the order. In an outside wall that is an
        // exterior door, which is not the same thing to buy as an inside one.
        expect(line(document, 'Exterior door 900 × 2100').quantity).toBe(1);
    });

    it('frames a veneer wall in 2x6, not in its whole thickness', () => {
        const document = baseDocument({
            wallTypes: [
                {
                    id: 'brick',
                    name: 'Exterior - Brick on Stud',
                    thickness: 302,
                    function: 'exterior',
                },
            ],
            elements: [wall('brick', 4000)],
        });

        // 302mm is brick, cavity and studs together. It is 2x6 you buy, and
        // 2x6 batts that go between them — not a 2x10 wall.
        const materials = takeOff(document).lines.map((item) => item.material);

        expect(materials).toContain('38 × 140 stud, 2286 long');
        expect(materials).toContain('Batt insulation 140mm');
    });

    it('sizes the stud off the wall it is in', () => {
        const thin = baseDocument({ elements: [wall('partition', 3000)] });

        // A 92mm partition frames in 2x4, not 2x6.
        expect(
            takeOff(thin).lines.some((item) =>
                item.material.startsWith('38 × 89 stud'),
            ),
        ).toBe(true);
    });
});

describe('pouring concrete', () => {
    it('measures a concrete wall by volume, with formwork and rebar', () => {
        const document = baseDocument({
            elements: [wall('concrete-300', 5000)],
        });

        // 5m × 2.4m × 0.3m is three and a half cubic metres.
        const concrete = line(document, 'Cast-in-place concrete');

        expect(concrete.unit).toBe('volume');
        expect(concrete.quantity).toBe(5000 * 2400 * 300);
        expect(formatQuantity(concrete.quantity, 'volume', 'metric')).toBe(
            '3.60 m³',
        );

        // Formwork stands against both faces.
        expect(line(document, 'Wall formwork').quantity).toBe(2 * 5000 * 2400);
        expect(line(document, 'Rebar 15M').unit).toBe('length');

        // Nothing framed about it.
        expect(
            takeOff(document).lines.some((item) =>
                item.material.includes('stud'),
            ),
        ).toBe(false);
    });

    it('adds up concrete from every source into one order', () => {
        const footing: FootingElement = {
            id: 'footing-1',
            kind: 'footing',
            level: 'level-1',
            p: { x: 0, y: 0 },
            width: 1000,
            depth: 300,
        };
        const slab: FloorElement = {
            id: 'slab-1',
            kind: 'floor',
            level: 'level-1',
            thickness: 150,
            offset: 0,
            points: [
                { x: 0, y: 0 },
                { x: 4000, y: 0 },
                { x: 4000, y: 3000 },
                { x: 0, y: 3000 },
            ],
        };
        const document = baseDocument({ elements: [footing, slab] });
        const concrete = line(document, 'Cast-in-place concrete');

        // The pad and the slab arrive on the same truck.
        expect(concrete.from).toBe(2);
        expect(concrete.quantity).toBe(1000 * 1000 * 300 + 4000 * 3000 * 150);
    });

    it('pours a floor too thin to joist and frames the rest', () => {
        const points = [
            { x: 0, y: 0 },
            { x: 4000, y: 0 },
            { x: 4000, y: 3000 },
            { x: 0, y: 3000 },
        ];
        const framed = baseDocument({
            elements: [
                {
                    id: 'floor-1',
                    kind: 'floor',
                    level: 'level-1',
                    thickness: 235,
                    offset: 0,
                    points,
                } as FloorElement,
            ],
        });

        expect(constructionOf(framed, framed.elements[0])).toBe('wood');

        // 150mm cannot be joisted — the shallowest joist is deeper — so it
        // is a slab, and the same outline pours instead.
        const slab = baseDocument({
            elements: [
                {
                    id: 'floor-1',
                    kind: 'floor',
                    level: 'level-1',
                    thickness: 150,
                    offset: 0,
                    points,
                } as FloorElement,
            ],
        });

        expect(constructionOf(slab, slab.elements[0])).toBe('concrete');
        expect(line(slab, 'Cast-in-place concrete').quantity).toBe(
            4000 * 3000 * 150,
        );
        expect(line(framed, 'Subfloor 18mm T&G').quantity).toBe(4000 * 3000);
        // Joists at 400 centres: a bay's length of joist per bay.
        expect(line(framed, '38 × 235 joist').quantity).toBe(
            (4000 * 3000) / 400,
        );
    });
});

describe('the sheet as a whole', () => {
    it('leaves out what is not being built', () => {
        const document = baseDocument({
            elements: [
                wall('stud-140', 4000),
                { ...wall('stud-140', 9000), id: 'old', phase: 'existing' },
                { ...wall('stud-140', 9000), id: 'going', phase: 'demolished' },
            ],
        });

        // Only the new wall is on the order.
        expect(line(document, '38 × 140 plate').quantity).toBe(12_000);
        expect(line(document, '38 × 140 plate').from).toBe(1);
    });

    it('ignores annotation, which is drawn rather than built', () => {
        const document = baseDocument({
            elements: [
                {
                    id: 'dim-1',
                    kind: 'dimension',
                    level: 'level-1',
                    a: { x: 0, y: 0 },
                    b: { x: 1000, y: 0 },
                    offset: 500,
                },
                {
                    id: 'text-1',
                    kind: 'text',
                    level: 'level-1',
                    p: { x: 0, y: 0 },
                    value: 'note',
                    size: 120,
                },
            ],
        });

        expect(takeOff(document).lines).toHaveLength(0);
        expect(takeOff(document).counted).toBe(0);
    });

    it('adds waste to sheet goods but never to counted pieces', () => {
        const document = baseDocument({ elements: [wall('stud-140', 4000)] });

        const studs = line(document, '38 × 140 stud, 2286 long');
        const sheathing = line(document, 'Sheathing 11mm OSB');

        expect(studs.waste).toBe(0);
        expect(orderQuantity(studs)).toBe(studs.quantity);

        expect(sheathing.waste).toBe(0.1);
        expect(orderQuantity(sheathing)).toBeCloseTo(sheathing.quantity * 1.1);
    });

    it('rounds pieces up, because half a stud is no use', () => {
        expect(formatQuantity(10.2, 'each', 'metric')).toBe('11');
        expect(formatQuantity(11, 'each', 'metric')).toBe('11');
        expect(formatQuantity(4000, 'length', 'metric')).toBe('4.0 m');
        expect(formatQuantity(4000, 'length', 'imperial')).toBe('13.1 ft');
    });

    it('sorts by trade, so the sheet reads in build order', () => {
        const document = baseDocument({
            elements: [wall('stud-140', 4000), wall('concrete-300', 4000)],
        });

        const sections = takeOff(document).lines.map((item) => item.section);
        const firstFraming = sections.indexOf('framing');

        // Concrete is poured before anything is stood on it.
        expect(sections.indexOf('concrete')).toBeLessThan(firstFraming);
        expect(sections.indexOf('framing')).toBeLessThan(
            sections.lastIndexOf('finishes'),
        );
    });

    it('writes a spreadsheet an estimator can price', () => {
        const document = baseDocument({ elements: [wall('stud-140', 4000)] });
        const csv = takeoffCsv(takeOff(document), 'metric');
        const [header, ...rows] = csv.split('\n');

        expect(header).toBe(
            'Section,Material,Unit,Quantity,Waste %,Order,Order (raw),From elements',
        );
        expect(rows.length).toBe(takeOff(document).lines.length);
        // The raw column is a bare number, ready to multiply by a rate.
        expect(rows[0].split(',').at(-2)).toMatch(/^\d+\.\d{3}$/);
    });

    it('quotes anything carrying a comma', () => {
        const document = baseDocument({ elements: [wall('stud-140', 4000)] });
        const csv = takeoffCsv(takeOff(document), 'metric');

        // "Concrete & Foundations" is safe, but a stud's name has a comma.
        expect(csv).toContain('"38 × 140 stud, 2286 long"');
    });
});

/* ------------------------------------------------- the rest of the house */

describe('what holds the building down', () => {
    const document = baseDocument({ elements: [wall('stud-140', 5400)] });

    it('bolts a ground floor wall to its foundation', () => {
        expect(line(document, 'Sill plate, treated').quantity).toBe(5400);
        expect(line(document, 'Sill gasket').quantity).toBe(5400);
        // Every 1800, and never fewer than two in one plate.
        expect(line(document, 'Anchor bolt with washer and nut').quantity).toBe(3);
    });

    it('does not bolt an upper wall to anything', () => {
        const upstairs = baseDocument({
            levels: [
                { id: 'level-1', name: 'Ground', elevation: 0 },
                { id: 'level-2', name: 'First', elevation: 3000 },
            ],
            elements: [wall('stud-140', 5400, { level: 'level-2' })],
        });

        expect(
            takeOff(upstairs).lines.find(
                (item) => item.material === 'Sill plate, treated',
            ),
        ).toBeUndefined();
    });
});

describe('closing the building in', () => {
    const document = baseDocument({ elements: [wall('stud-140', 5000)] });

    it('seals and wraps the outside face', () => {
        expect(line(document, 'Air and vapour barrier').section).toBe(
            'insulation',
        );
        expect(line(document, 'Batt insulation 140mm').section).toBe(
            'insulation',
        );
        expect(line(document, 'Sealant and caulking').quantity).toBeGreaterThan(0);
        expect(line(document, 'Exterior paint, litres').quantity).toBeGreaterThan(0);
    });

    it('runs baseboard round the finished sides, less the doorways', () => {
        const partition = baseDocument({
            elements: [wall('partition', 5000)],
        });

        // Two finished sides on an inside wall, one on an outside one.
        expect(line(partition, 'Baseboard').quantity).toBe(10_000);
        expect(line(document, 'Baseboard').quantity).toBe(5000);
    });
});

describe('roofing', () => {
    const roof = baseDocument({
        elements: [
            {
                id: 'roof-1',
                kind: 'roof',
                level: 'level-1',
                points: [
                    { x: 0, y: 0 },
                    { x: 12_000, y: 0 },
                    { x: 12_000, y: 8000 },
                    { x: 0, y: 8000 },
                ],
                slope: 30,
                overhang: 600,
                baseOffset: 2400,
            } as CadElement,
        ],
    });

    it('covers the roof and finishes its edges', () => {
        ['Asphalt shingles', 'Roofing underlay', 'Ridge cap shingles',
            'Drip edge flashing', 'Step and valley flashing', 'Fascia',
            'Soffit', 'Gutter'].forEach((material) => {
            expect(line(roof, material).section).toBe('roofing');
        });
    });

    it('runs the ridge the long way, not across the short way', () => {
        // A 13.2 × 9.2 m roof over the eaves: the ridge is the difference.
        expect(line(roof, 'Ridge cap shingles').quantity).toBeCloseTo(4000, 0);
    });

    it('gives a square roof no ridge, because a pyramid has none', () => {
        const pyramid = baseDocument({
            elements: [
                {
                    ...(roof.elements[0] as CadElement),
                    points: [
                        { x: 0, y: 0 },
                        { x: 8000, y: 0 },
                        { x: 8000, y: 8000 },
                        { x: 0, y: 8000 },
                    ],
                } as CadElement,
            ],
        });

        expect(
            takeOff(pyramid).lines.find(
                (item) => item.material === 'Ridge cap shingles',
            ),
        ).toBeUndefined();
    });

    it('hangs a downspout on every stretch of gutter', () => {
        expect(line(roof, 'Downspout').quantity).toBe(4);
        expect(line(roof, 'Roof vent').quantity).toBeGreaterThan(0);
    });
});

describe('the trades nobody drew', () => {
    const house = baseDocument({
        elements: [
            {
                id: 'floor-1',
                kind: 'floor',
                level: 'level-1',
                points: [
                    { x: 0, y: 0 },
                    { x: 10_000, y: 0 },
                    { x: 10_000, y: 8000 },
                    { x: 0, y: 8000 },
                ],
                thickness: 240,
                offset: 0,
            } as FloorElement,
        ],
    });

    it('gives the house a panel, a boiler and a furnace', () => {
        expect(line(house, 'Distribution panel 200A').quantity).toBe(1);
        expect(line(house, 'Water heater').quantity).toBe(1);
        expect(line(house, 'Furnace and air handler').quantity).toBe(1);
        expect(line(house, 'Thermostat').quantity).toBe(1);
    });

    it('wires it to the floor area it has', () => {
        // 80 m² at one socket per 12 gives seven, and cable to reach them.
        expect(line(house, 'Socket outlet').quantity).toBe(7);
        expect(line(house, 'Romex cable 14/2').quantity).toBeGreaterThan(0);
        expect(line(house, 'Smoke and CO alarm').quantity).toBeGreaterThan(0);
    });

    it('leaves an empty drawing alone', () => {
        // Nothing drawn is not a house with a panel in it.
        expect(
            takeOff(baseDocument()).lines.find(
                (item) => item.material === 'Distribution panel 200A',
            ),
        ).toBeUndefined();
    });

    it('files each trade under its own heading', () => {
        expect(line(house, 'Socket outlet').section).toBe('electrical');
        expect(line(house, 'Water heater').section).toBe('plumbing');
        expect(line(house, 'Register and grille').section).toBe('hvac');
    });
});

describe('what follows on from everything else', () => {
    const document = baseDocument({ elements: [wall('stud-140', 5000)] });

    it('buys screws for the board and nails for the sheathing', () => {
        const board = line(document, 'Gypsum board 12.7mm').quantity / 1e6;

        expect(line(document, 'Drywall screw 32mm').quantity).toBeCloseTo(
            board * 30,
            3,
        );
        expect(line(document, 'Sheathing nail 60mm').quantity).toBeGreaterThan(0);
        expect(line(document, 'Framing nail 90mm').quantity).toBeGreaterThan(0);
    });

    it('buys tape, compound and paint for the board', () => {
        expect(line(document, 'Joint tape, roll').quantity).toBeGreaterThan(0);
        expect(line(document, 'Joint compound, litres').quantity).toBeGreaterThan(0);
        expect(line(document, 'Interior primer, litres').quantity).toBeGreaterThan(0);
        // Two coats over one of primer.
        expect(line(document, 'Interior paint, litres').quantity).toBeCloseTo(
            line(document, 'Interior primer, litres').quantity * 2,
            6,
        );
    });

    it('files the fasteners under hardware', () => {
        expect(line(document, 'Drywall screw 32mm').section).toBe('hardware');
        expect(line(document, 'Sealant, tube').section).toBe('hardware');
    });
});

describe('doors and windows', () => {
    it('tells an outside door from an inside one', () => {
        const outside = baseDocument({
            elements: [
                wall('stud-140', 4000),
                {
                    id: 'd1',
                    kind: 'door',
                    level: 'level-1',
                    typeId: 'door-900',
                    host: 'wall-stud-140-4000',
                    t: 0.5,
                    flipFace: false,
                    flipHand: false,
                } as CadElement,
            ],
        });

        expect(line(outside, 'Exterior door 900 × 2100').quantity).toBe(1);
        expect(line(outside, 'Entry lockset and deadbolt').quantity).toBe(1);
        expect(line(outside, 'Butt hinge').quantity).toBe(3);
        expect(line(outside, 'Door weatherstripping').quantity).toBeGreaterThan(0);
        expect(line(outside, 'Door threshold').quantity).toBe(900);
    });

    it('does not weatherstrip a door between two rooms', () => {
        const inside = baseDocument({
            elements: [
                wall('partition', 4000),
                {
                    id: 'd1',
                    kind: 'door',
                    level: 'level-1',
                    typeId: 'door-900',
                    host: 'wall-partition-4000',
                    t: 0.5,
                    flipFace: false,
                    flipHand: false,
                } as CadElement,
            ],
        });

        expect(line(inside, 'Interior door 900 × 2100').quantity).toBe(1);
        expect(line(inside, 'Passage lockset').quantity).toBe(1);
        expect(
            takeOff(inside).lines.find(
                (item) => item.material === 'Door weatherstripping',
            ),
        ).toBeUndefined();
    });

    it('tapes a window into the wrap', () => {
        const glazed = baseDocument({
            elements: [
                wall('stud-140', 4000),
                {
                    id: 'w1',
                    kind: 'window',
                    level: 'level-1',
                    typeId: 'win-1200',
                    host: 'wall-stud-140-4000',
                    t: 0.5,
                    flipFace: false,
                    flipHand: false,
                } as CadElement,
            ],
        });

        expect(line(glazed, 'Window flashing tape').quantity).toBe(4800);
        expect(line(glazed, 'Interior casing').quantity).toBe(4800);
    });
});
