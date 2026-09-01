import { describe, expect, it } from 'vitest';
import {
    asNumber,
    asNumbers,
    asString,
    deref,
    derefAll,
    parseSpf,
    SpfParseError,
} from '@/lib/cad/exchange/spf';

const FILE = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('house.ifc','2026-09-01T09:00:00',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCCARTESIANPOINT((0.,0.,0.));
#2=IFCCARTESIANPOINT((6000.,0.,0.));
#3=IFCDIRECTION((0.,0.,1.));
#4=IFCAXIS2PLACEMENT3D(#1,#3,$);
#5=IFCRECTANGLEPROFILEDEF(.AREA.,'Basic Wall',#4,6000.,200.);
#6=IFCWALL('3vB2YO$MX4xv5uCqZZG05x',$,'Wall it''s called',$,$,#4,#5,$);
#7=IFCPROPERTYSINGLEVALUE('Width',$,IFCLENGTHMEASURE(0.2),$);
#8=IFCRELAGGREGATES('guid',$,$,$,#6,(#1,#2));
ENDSEC;
END-ISO-10303-21;
`;

describe('reading a STEP physical file', () => {
    const file = parseSpf(FILE);

    it('knows which schema it is', () => {
        expect(file.schema).toBe('IFC4');
    });

    it('numbers every entity', () => {
        expect(file.entities.get(6)?.type).toBe('IFCWALL');
        expect(file.entities.size).toBe(8);
    });

    it('gathers entities by type', () => {
        expect(file.byType.get('IFCCARTESIANPOINT')).toHaveLength(2);
        expect(file.byType.get('IFCWALL')).toHaveLength(1);
    });

    it('reads coordinates as numbers', () => {
        expect(asNumbers(file.entities.get(2)?.args[0])).toEqual([6000, 0, 0]);
    });

    it('reads a quoted string, and a quote inside one', () => {
        // Two quotes in a row is one quote, not the end of the string — and
        // the comma-free rest of the argument list must survive it.
        expect(asString(file.entities.get(6)?.args[2])).toBe(
            "Wall it's called",
        );
        expect(file.entities.get(6)?.args).toHaveLength(8);
    });

    it('reads an enumeration', () => {
        expect(file.entities.get(5)?.args[0]).toEqual({
            kind: 'enum',
            value: 'AREA',
        });
    });

    it('treats $ as nothing at all', () => {
        expect(file.entities.get(6)?.args[1]).toEqual({ kind: 'null' });
    });

    it('unwraps a measure written inline', () => {
        expect(asNumber(file.entities.get(7)?.args[2])).toBe(0.2);
    });

    it('follows a reference', () => {
        const wall = file.entities.get(6)!;

        expect(deref(file, wall.args[6])?.type).toBe('IFCRECTANGLEPROFILEDEF');
        expect(deref(file, wall.args[1])).toBeNull();
    });

    it('follows a list of references', () => {
        const relation = file.entities.get(8)!;

        expect(derefAll(file, relation.args[5]).map((item) => item.id)).toEqual(
            [1, 2],
        );
    });

    it('reads the profile a wall is extruded from', () => {
        const profile = file.entities.get(5)!;

        expect(asNumber(profile.args[3])).toBe(6000);
        expect(asNumber(profile.args[4])).toBe(200);
    });
});

describe('what it refuses', () => {
    it('turns away something that is not a STEP file at all', () => {
        expect(() => parseSpf('{"walls":[]}')).toThrow(SpfParseError);
    });

    it('turns away a header with no entities under it', () => {
        expect(() =>
            parseSpf('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\n'),
        ).toThrow(SpfParseError);
    });

    it('is not fooled by a semicolon inside a name', () => {
        const tricky = parseSpf(
            `ISO-10303-21;\nDATA;\n#1=IFCWALL('a;b','second');\nENDSEC;\n`,
        );

        expect(asString(tricky.entities.get(1)?.args[0])).toBe('a;b');
        expect(tricky.entities.get(1)?.args).toHaveLength(2);
    });

    it('ignores comments', () => {
        const commented = parseSpf(
            `ISO-10303-21;\nDATA;\n/* a note */\n#1=IFCWALL('x');\nENDSEC;\n`,
        );

        expect(commented.entities.size).toBe(1);
    });
});
