import type { Units } from '@/lib/cad/types';

const MM_PER_INCH = 25.4;
const MM_PER_FOOT = 304.8;
const SQ_MM_PER_SQ_FOOT = 92903.04;
const CU_MM_PER_CU_YARD = 764554857.984;
const CU_MM_PER_CU_METRE = 1_000_000_000;

/** Denominator used when rounding imperial lengths, matching Revit's default. */
const IMPERIAL_DENOMINATOR = 16;

/**
 * Format a millimetre length for display, e.g. `3,000 mm` or `9' - 10 1/8"`.
 */
export function formatLength(millimetres: number, units: Units): string {
    if (units === 'imperial') {
        return formatFeetInches(millimetres);
    }

    return `${Math.round(millimetres).toLocaleString('en-CA')} mm`;
}

/**
 * Format a length for annotation on the canvas, where the unit suffix would be
 * noise on a metric drawing.
 */
export function formatDimension(millimetres: number, units: Units): string {
    if (units === 'imperial') {
        return formatFeetInches(millimetres);
    }

    return Math.round(millimetres).toLocaleString('en-CA');
}

export function formatArea(squareMillimetres: number, units: Units): string {
    if (units === 'imperial') {
        return `${(squareMillimetres / SQ_MM_PER_SQ_FOOT).toFixed(0)} SF`;
    }

    return `${(squareMillimetres / 1_000_000).toFixed(2)} m²`;
}

/**
 * Format a volume for a materials list, where concrete is ordered by the
 * cubic metre here and by the cubic yard where the drawing is in feet.
 */
export function formatVolume(cubicMillimetres: number, units: Units): string {
    if (units === 'imperial') {
        return `${(cubicMillimetres / CU_MM_PER_CU_YARD).toFixed(2)} CY`;
    }

    return `${(cubicMillimetres / CU_MM_PER_CU_METRE).toFixed(2)} m³`;
}

export function formatAngle(degrees: number): string {
    const normalized = ((degrees % 360) + 360) % 360;

    return `${normalized.toFixed(2)}°`;
}

export function formatScale(scale: number): string {
    return `1 : ${scale}`;
}

function formatFeetInches(millimetres: number): string {
    const sign = millimetres < 0 ? '-' : '';
    const totalInches = Math.abs(millimetres) / MM_PER_INCH;

    let feet = Math.floor(totalInches / 12);
    let inches = Math.floor(totalInches - feet * 12);
    let numerator = Math.round(
        (totalInches - feet * 12 - inches) * IMPERIAL_DENOMINATOR,
    );
    let denominator = IMPERIAL_DENOMINATOR;

    if (numerator === denominator) {
        numerator = 0;
        inches += 1;
    }

    if (inches === 12) {
        inches = 0;
        feet += 1;
    }

    while (numerator > 0 && numerator % 2 === 0) {
        numerator /= 2;
        denominator /= 2;
    }

    const fraction = numerator > 0 ? ` ${numerator}/${denominator}` : '';

    if (inches === 0 && numerator === 0) {
        return `${sign}${feet}'`;
    }

    return `${sign}${feet}' - ${inches}${fraction}"`;
}

/**
 * Parse user input into millimetres. Accepts `3000`, `3 m`, `12'-6"`,
 * `12' 6 1/2"` and `6 1/2"`. Returns null when the value is unusable.
 */
export function parseLength(input: string, units: Units): number | null {
    const text = input.trim().toLowerCase().replace(/,/g, '');

    if (text === '') {
        return null;
    }

    const metricMatch = text.match(/^(-?[\d.]+)\s*(mm|cm|m)$/);

    if (metricMatch) {
        const value = Number.parseFloat(metricMatch[1]);
        const factor =
            metricMatch[2] === 'mm' ? 1 : metricMatch[2] === 'cm' ? 10 : 1000;

        return Number.isFinite(value) ? value * factor : null;
    }

    if (text.includes("'") || text.includes('"')) {
        return parseFeetInches(text);
    }

    const plain = Number.parseFloat(text);

    if (!Number.isFinite(plain)) {
        return null;
    }

    return units === 'imperial' ? plain * MM_PER_FOOT : plain;
}

function parseFeetInches(text: string): number | null {
    const negative = text.startsWith('-');
    const body = negative ? text.slice(1) : text;

    const feetMatch = body.match(/(-?[\d.]+)\s*'/);
    const feet = feetMatch ? Number.parseFloat(feetMatch[1]) : 0;

    const remainder = feetMatch ? body.slice(body.indexOf("'") + 1) : body;
    const inchesBody = remainder
        .replace(/"/g, '')
        .replace(/^\s*-\s*/, '')
        .trim();

    let inches = 0;

    if (inchesBody !== '') {
        const fractionMatch = inchesBody.match(
            /^(?:([\d.]+)\s+)?(\d+)\s*\/\s*(\d+)$/,
        );

        if (fractionMatch) {
            const whole = fractionMatch[1]
                ? Number.parseFloat(fractionMatch[1])
                : 0;
            inches =
                whole +
                Number.parseInt(fractionMatch[2], 10) /
                    Number.parseInt(fractionMatch[3], 10);
        } else {
            inches = Number.parseFloat(inchesBody);
        }
    }

    if (!Number.isFinite(feet) || !Number.isFinite(inches)) {
        return null;
    }

    const millimetres = feet * MM_PER_FOOT + inches * MM_PER_INCH;

    return negative ? -millimetres : millimetres;
}

/**
 * The rounding increment used while drawing, chosen so metric plans land on
 * neat millimetres and imperial plans land on the nearest inch.
 */
export function drawingIncrement(units: Units): number {
    return units === 'imperial' ? MM_PER_INCH : 10;
}

/** Spacing of the background grid, in millimetres. */
export function gridSpacing(units: Units): number {
    return units === 'imperial' ? MM_PER_FOOT : 1000;
}
