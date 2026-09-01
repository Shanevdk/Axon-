import { describe, expect, it } from 'vitest';
import {
    drawingFilename,
    isCadDocument,
    parseDrawing,
} from '@/lib/cad/transfer';
import type { CadDocument } from '@/lib/cad/types';

function document(): CadDocument {
    return {
        version: 1,
        units: 'metric',
        levels: [{ id: 'level-1', name: 'Level 1', elevation: 0 }],
        wallTypes: [
            {
                id: 'generic-200',
                name: 'Generic - 200mm',
                thickness: 200,
                function: 'exterior',
            },
        ],
        doorTypes: [],
        windowTypes: [],
        elements: [],
        viewSettings: {},
    };
}

describe('drawingFilename', () => {
    it('makes a project name safe to save', () => {
        expect(drawingFilename('Ridgeway Laneway House')).toBe(
            'ridgeway-laneway-house.axon.json',
        );
        expect(drawingFilename('12 Elm St. — Phase 2')).toBe(
            '12-elm-st-phase-2.axon.json',
        );
    });

    it('falls back rather than producing a bare extension', () => {
        expect(drawingFilename('!!!')).toBe('drawing.axon.json');
    });
});

describe('parseDrawing', () => {
    it('reads a drawing back exactly as it went out', () => {
        const original = document();
        const returned = parseDrawing(JSON.stringify(original, null, 2));

        expect(returned).toEqual(original);
    });

    it('refuses something that is not JSON', () => {
        expect(() => parseDrawing('solid teapot\nfacet normal')).toThrow(
            /not even JSON/,
        );
    });

    it('refuses JSON that is not a drawing', () => {
        expect(() => parseDrawing('{"hello":"world"}')).toThrow(
            /not an Vanhaven drawing/,
        );
    });

    it('refuses a document missing its type catalogues', () => {
        const broken = { ...document() } as Partial<CadDocument>;

        delete broken.wallTypes;

        // This shape is exactly what used to leave the editor on a black screen.
        expect(() => parseDrawing(JSON.stringify(broken))).toThrow();
    });

    it('refuses a document with no levels', () => {
        expect(isCadDocument({ ...document(), levels: [] })).toBe(false);
    });

    it('refuses unknown units', () => {
        expect(isCadDocument({ ...document(), units: 'furlongs' })).toBe(false);
    });
});
