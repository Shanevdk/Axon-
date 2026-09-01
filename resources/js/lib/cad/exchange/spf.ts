/**
 * The STEP physical file, which is the shape IFC is written in.
 *
 * ISO 10303-21 is a flat list of numbered entities, each one a type and its
 * arguments, with references between them by number:
 *
 *     #14=IFCWALL('3vB2YO$MX4xv5uCqZZG05x',#5,'Basic Wall',$,…,#212,#231,$);
 *
 * That is all this reads. It does not know what an IFCWALL is — resolving
 * that is `ifc.ts`'s job — it only turns the text into entities that can be
 * looked up by number and walked.
 *
 * The same grammar carries our own STEP exports, so a parser here is worth
 * more than the one format that needed it.
 */

/** A value in an entity's argument list. */
export type SpfValue =
    | { kind: 'ref'; id: number }
    | { kind: 'string'; value: string }
    | { kind: 'number'; value: number }
    | { kind: 'enum'; value: string }
    | { kind: 'null' }
    | { kind: 'list'; items: SpfValue[] }
    /** A typed value written inline, like IFCLENGTHMEASURE(0.2). */
    | { kind: 'typed'; type: string; items: SpfValue[] };

export type SpfEntity = {
    id: number;
    type: string;
    args: SpfValue[];
};

export type SpfFile = {
    /** Entities by their `#` number. */
    entities: Map<number, SpfEntity>;
    /** Every entity of a type, upper-cased, for finding a starting point. */
    byType: Map<string, SpfEntity[]>;
    /** The FILE_SCHEMA line, which is how IFC announces its version. */
    schema: string | null;
};

export class SpfParseError extends Error {}

/**
 * Read a STEP physical file.
 *
 * @throws SpfParseError when the text is not one at all
 */
export function parseSpf(text: string): SpfFile {
    if (!text.includes('ISO-10303-21')) {
        throw new SpfParseError(
            'That file is not a STEP or IFC file — it has no ISO-10303-21 header.',
        );
    }

    const entities = new Map<number, SpfEntity>();
    const byType = new Map<string, SpfEntity[]>();

    const body = stripComments(text);
    const schema = readSchema(body);

    // Statements are separated by semicolons, but a semicolon inside a quoted
    // string is just a semicolon, so the split has to know about quotes.
    for (const statement of statements(body)) {
        const entity = readEntity(statement);

        if (!entity) {
            continue;
        }

        entities.set(entity.id, entity);

        const kin = byType.get(entity.type) ?? [];
        kin.push(entity);
        byType.set(entity.type, kin);
    }

    if (entities.size === 0) {
        throw new SpfParseError('That file has no entities in it.');
    }

    return { entities, byType, schema };
}

/* ------------------------------------------------------------- reading */

function stripComments(text: string): string {
    // /* … */ is the only comment the format has, and it may not nest.
    return text.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function readSchema(text: string): string | null {
    const found = /FILE_SCHEMA\s*\(\s*\(\s*'([^']*)'/i.exec(text);

    return found ? found[1] : null;
}

/** Split on semicolons that are not inside a quoted string. */
function* statements(text: string): Generator<string> {
    let start = 0;
    let quoted = false;

    for (let index = 0; index < text.length; index++) {
        const character = text[index];

        if (character === "'") {
            // Two quotes in a row is an escaped quote, not the end of one.
            if (quoted && text[index + 1] === "'") {
                index++;

                continue;
            }

            quoted = !quoted;

            continue;
        }

        if (character === ';' && !quoted) {
            yield text.slice(start, index);
            start = index + 1;
        }
    }
}

const ENTITY = /^\s*#(\d+)\s*=\s*([A-Za-z0-9_]+)\s*\(/;

function readEntity(statement: string): SpfEntity | null {
    const head = ENTITY.exec(statement);

    if (!head) {
        return null;
    }

    const open = statement.indexOf('(', head[0].length - 1);
    const close = statement.lastIndexOf(')');

    if (open < 0 || close < open) {
        return null;
    }

    return {
        id: Number(head[1]),
        type: head[2].toUpperCase(),
        args: readList(statement.slice(open + 1, close)),
    };
}

/**
 * Read one comma-separated argument list.
 *
 * Commas inside nested brackets and inside quoted strings belong to those,
 * not to this list, so the split tracks both.
 */
function readList(text: string): SpfValue[] {
    const values: SpfValue[] = [];
    let depth = 0;
    let quoted = false;
    let start = 0;
    let empty = true;

    const push = (piece: string) => {
        const trimmed = piece.trim();

        if (trimmed !== '' || !empty) {
            values.push(readValue(trimmed));
        }
    };

    for (let index = 0; index < text.length; index++) {
        const character = text[index];

        if (character === "'") {
            if (quoted && text[index + 1] === "'") {
                index++;

                continue;
            }

            quoted = !quoted;
            empty = false;

            continue;
        }

        if (quoted) {
            continue;
        }

        if (character === '(') {
            depth++;
            empty = false;

            continue;
        }

        if (character === ')') {
            depth--;

            continue;
        }

        if (character === ',' && depth === 0) {
            empty = false;
            push(text.slice(start, index));
            start = index + 1;
        }

        if (!/\s/.test(character)) {
            empty = false;
        }
    }

    if (text.trim() !== '' || values.length > 0) {
        push(text.slice(start));
    }

    return values;
}

function readValue(text: string): SpfValue {
    if (text === '' || text === '$' || text === '*') {
        return { kind: 'null' };
    }

    if (text.startsWith('#')) {
        return { kind: 'ref', id: Number(text.slice(1)) };
    }

    if (text.startsWith("'")) {
        return { kind: 'string', value: unquote(text) };
    }

    if (text.startsWith('.') && text.endsWith('.')) {
        return { kind: 'enum', value: text.slice(1, -1) };
    }

    if (text.startsWith('(')) {
        return { kind: 'list', items: readList(text.slice(1, -1)) };
    }

    const typed = /^([A-Za-z0-9_]+)\s*\(([\s\S]*)\)$/.exec(text);

    if (typed) {
        return {
            kind: 'typed',
            type: typed[1].toUpperCase(),
            items: readList(typed[2]),
        };
    }

    const number = Number(text);

    return Number.isFinite(number)
        ? { kind: 'number', value: number }
        : { kind: 'enum', value: text };
}

/**
 * Undo the quoting: doubled quotes are one quote, and non-ASCII arrives as
 * \X2\…\X0\ escapes, which is how IFC carries anything past plain ASCII.
 */
function unquote(text: string): string {
    const inner = text.slice(1, -1).replace(/''/g, "'");

    return inner.replace(/\\X2\\([0-9A-Fa-f]+)\\X0\\/g, (_, hex: string) =>
        (hex.match(/.{4}/g) ?? [])
            .map((unit) => String.fromCharCode(parseInt(unit, 16)))
            .join(''),
    );
}

/* ------------------------------------------------------------- walking */

/** The entity an argument points at, or null if it points at nothing. */
export function deref(
    file: SpfFile,
    value: SpfValue | undefined,
): SpfEntity | null {
    return value?.kind === 'ref'
        ? (file.entities.get(value.id) ?? null)
        : null;
}

/** Every entity in a list argument. */
export function derefAll(
    file: SpfFile,
    value: SpfValue | undefined,
): SpfEntity[] {
    if (value?.kind !== 'list') {
        return [];
    }

    return value.items
        .map((item) => deref(file, item))
        .filter((entity): entity is SpfEntity => entity !== null);
}

/** A plain number from an argument, unwrapping a typed measure if need be. */
export function asNumber(value: SpfValue | undefined): number | null {
    if (value?.kind === 'number') {
        return value.value;
    }

    if (value?.kind === 'typed' && value.items.length === 1) {
        return asNumber(value.items[0]);
    }

    return null;
}

export function asString(value: SpfValue | undefined): string | null {
    return value?.kind === 'string' ? value.value : null;
}

/** A list of numbers, which is how every coordinate in IFC is written. */
export function asNumbers(value: SpfValue | undefined): number[] {
    if (value?.kind !== 'list') {
        return [];
    }

    return value.items
        .map(asNumber)
        .filter((number): number is number => number !== null);
}
