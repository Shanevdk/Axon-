import { describe, expect, it } from 'vitest';
import { describeDesign, renderPrompt } from '@/lib/cad/brief';
import type {
    CadDocument,
    RoofElement,
    WallElement,
    WindowElement,
} from '@/lib/cad/types';

function documentWith(elements: CadDocument['elements']): CadDocument {
    return {
        version: 1,
        units: 'metric',
        levels: [
            { id: 'level-1', name: 'Level 1', elevation: 0 },
            { id: 'level-2', name: 'Level 2', elevation: 3000 },
        ],
        wallTypes: [
            {
                id: 'brick-300',
                name: 'Exterior - Brick on Block',
                thickness: 300,
                function: 'exterior',
            },
            {
                id: 'partition',
                name: 'Interior - Partition',
                thickness: 100,
                function: 'interior',
            },
            {
                id: 'curtain-storefront',
                name: 'Curtain Wall - Storefront',
                thickness: 150,
                function: 'curtain',
            },
        ],
        doorTypes: [],
        windowTypes: [
            {
                id: 'window-large',
                name: 'Fixed - Large',
                width: 3000,
                height: 2400,
                sillHeight: 300,
            },
        ],
        elements,
        viewSettings: {},
    };
}

function wall(
    id: string,
    level: string,
    typeId: string,
    a: [number, number],
    b: [number, number],
): WallElement {
    return {
        id,
        kind: 'wall',
        level,
        typeId,
        a: { x: a[0], y: a[1] },
        b: { x: b[0], y: b[1] },
        height: 3000,
        baseOffset: 0,
        locationLine: 'center',
    };
}

/** Four brick walls enclosing 10m x 8m, one per level. */
function shell(level: string): WallElement[] {
    return [
        wall(`${level}-n`, level, 'brick-300', [0, 0], [10000, 0]),
        wall(`${level}-e`, level, 'brick-300', [10000, 0], [10000, 8000]),
        wall(`${level}-s`, level, 'brick-300', [10000, 8000], [0, 8000]),
        wall(`${level}-w`, level, 'brick-300', [0, 8000], [0, 0]),
    ];
}

describe('describeDesign', () => {
    it('says so when nothing is drawn', () => {
        const brief = describeDesign(documentWith([]));

        expect(brief.empty).toBe(true);
        expect(brief.prompt).toBe('');
    });

    it('measures storeys, height and footprint from the model', () => {
        const brief = describeDesign(
            documentWith([...shell('level-1'), ...shell('level-2')]),
        );

        expect(brief.empty).toBe(false);
        // Level 2 sits at 3000 and carries a 3000 wall, so 6m to the eaves.
        expect(brief.facts).toContain('2 storeys, about 6 m to the eaves');
        expect(brief.facts).toContain('Footprint about 10 × 8 m');
        expect(brief.prompt).toContain('2-storey building roughly 6 metres');
        expect(brief.prompt).toContain('10 by 8 metres');
    });

    it('reads the cladding off the busiest exterior wall type', () => {
        const brief = describeDesign(
            documentWith([
                ...shell('level-1'),
                // A long interior partition must not win the material vote.
                wall('part', 'level-1', 'partition', [0, 4000], [10000, 4000]),
            ]),
        );

        expect(brief.facts).toContain('Mostly brick');
        expect(brief.prompt).toContain('brick cladding');
    });

    it('calls a heavily glazed facade a glass box', () => {
        const windows: WindowElement[] = Array.from({ length: 8 }, (_, i) => ({
            id: `w${i}`,
            kind: 'window',
            level: 'level-1',
            typeId: 'window-large',
            host: 'level-1-n',
            t: 0.1 * i,
            flipFace: false,
            flipHand: false,
        }));

        const brief = describeDesign(
            documentWith([...shell('level-1'), ...windows]),
        );

        expect(brief.facts).toContain('8 windows, heavily glazed');
        expect(brief.prompt).toContain('large expanses of glazing');
    });

    it('distinguishes a pitched roof from a flat one', () => {
        const pitched: RoofElement = {
            id: 'r1',
            kind: 'roof',
            level: 'level-1',
            points: [
                { x: 0, y: 0 },
                { x: 10000, y: 0 },
                { x: 10000, y: 8000 },
                { x: 0, y: 8000 },
            ],
            slope: 35,
            overhang: 500,
            baseOffset: 3000,
        };

        expect(
            describeDesign(documentWith([...shell('level-1'), pitched])).facts,
        ).toContain('Pitched roof at 35°');

        expect(
            describeDesign(
                documentWith([...shell('level-1'), { ...pitched, slope: 2 }]),
            ).facts,
        ).toContain('Flat roof');
    });

    it('notices curtain walling', () => {
        const brief = describeDesign(
            documentWith([
                ...shell('level-1'),
                wall('cw', 'level-1', 'curtain-storefront', [0, 0], [10000, 0]),
            ]),
        );

        expect(brief.facts).toContain('Curtain walling');
        expect(brief.prompt).toContain('curtain wall');
    });

    it('ignores demolished work', () => {
        const brief = describeDesign(
            documentWith([
                ...shell('level-1'),
                ...shell('level-2').map((element) => ({
                    ...element,
                    phase: 'demolished' as const,
                })),
            ]),
        );

        expect(brief.facts).toContain('Single storey');
    });
});

describe('renderPrompt', () => {
    it('frames the design and forbids everything else', () => {
        const composed = renderPrompt('a single-storey brick house', 'golden');

        expect(composed).toContain('Architectural photograph of');
        expect(composed).toContain('a single-storey brick house');
        expect(composed).toContain('golden-hour');
        expect(composed).toContain('Show only this one building');
        expect(composed).toContain('no people');
    });
});
