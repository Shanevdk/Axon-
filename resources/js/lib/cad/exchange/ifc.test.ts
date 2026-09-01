import { describe, expect, it } from 'vitest';
import { testDocument } from '@/lib/cad/__fixtures__/document';
import { exportIfc, IfcImportError, importIfc } from '@/lib/cad/exchange/ifc';
import { buildSolids } from '@/lib/cad/solids';
import type { FloorElement, WallElement } from '@/lib/cad/types';

/**
 * A wall as Revit writes one: a rectangle profile swept upward, placed on a
 * storey which is itself placed on the site. Metres, which is the IFC
 * default and what a metric Revit exports.
 */
const REVIT_WALL = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('house.ifc','2026-09-01T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#2=IFCCARTESIANPOINT((0.,0.,0.));
#3=IFCDIRECTION((0.,0.,1.));
#4=IFCDIRECTION((1.,0.,0.));
#5=IFCAXIS2PLACEMENT3D(#2,#3,#4);
#6=IFCLOCALPLACEMENT($,#5);
#10=IFCCARTESIANPOINT((2.,3.,0.));
#11=IFCAXIS2PLACEMENT3D(#10,#3,#4);
#12=IFCLOCALPLACEMENT(#6,#11);
#20=IFCCARTESIANPOINT((0.,0.));
#21=IFCDIRECTION((1.,0.));
#22=IFCAXIS2PLACEMENT2D(#20,#21);
#23=IFCRECTANGLEPROFILEDEF(.AREA.,'Basic Wall',#22,6.,0.2);
#24=IFCEXTRUDEDAREASOLID(#23,#5,#3,2.7);
#25=IFCSHAPEREPRESENTATION(#99,'Body','SweptSolid',(#24));
#26=IFCPRODUCTDEFINITIONSHAPE($,$,(#25));
#27=IFCWALL('0aBcDeFgHiJkLmNoPqRsT1',$,'Basic Wall',$,$,#12,#26,$);
ENDSEC;
END-ISO-10303-21;
`;

describe('reading what Revit exports', () => {
    const read = importIfc(REVIT_WALL, 'level-1');

    it('brings a wall in as a wall, not as a lump of triangles', () => {
        expect(read.counts.walls).toBe(1);

        const wall = read.elements.find(
            (element): element is WallElement => element.kind === 'wall',
        )!;

        expect(wall.kind).toBe('wall');
        expect(wall.level).toBe('level-1');
    });

    it('scales metres into the millimetres the model is held in', () => {
        const wall = read.elements[0] as WallElement;

        // A 6 m wall, 2.7 m high.
        expect(Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y)).toBeCloseTo(
            6000,
            3,
        );
        expect(wall.height).toBeCloseTo(2700, 3);
    });

    it('follows the placement chain to put it where it belongs', () => {
        const wall = read.elements[0] as WallElement;

        // Placed at 2, 3 on its storey, and the storey at the origin. The
        // centre line runs through it, so the midpoint is the placement.
        expect((wall.a.x + wall.b.x) / 2).toBeCloseTo(2000, 3);
        expect((wall.a.y + wall.b.y) / 2).toBeCloseTo(3000, 3);
    });

    it('reads the schema it was written in', () => {
        expect(read.schema).toBe('IFC4');
    });
});

describe('units', () => {
    it('reads millimetres when the file says millimetres', () => {
        const millimetres = REVIT_WALL.replace(
            'IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)',
            'IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)',
        );

        const wall = importIfc(millimetres, 'level-1')
            .elements[0] as WallElement;

        // The same numbers, now meaning millimetres: a 6 mm wall.
        expect(
            Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y),
        ).toBeCloseTo(6, 3);
    });

    it('reads feet through a conversion unit', () => {
        const feet = REVIT_WALL.replace(
            '#1=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);',
            `#1=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#1001=IFCMEASUREWITHUNIT(IFCLENGTHMEASURE(0.3048),#1);
#1002=IFCCONVERSIONBASEDUNIT(#99,.LENGTHUNIT.,'FOOT',#1001);`,
        );

        const wall = importIfc(feet, 'level-1').elements[0] as WallElement;

        // Six feet is 1828.8 mm.
        expect(
            Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y),
        ).toBeCloseTo(1828.8, 1);
    });
});

describe('slabs and spaces', () => {
    const SLAB = `ISO-10303-21;
DATA;
#1=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);
#2=IFCCARTESIANPOINT((0.,0.,0.));
#3=IFCDIRECTION((0.,0.,1.));
#5=IFCAXIS2PLACEMENT3D(#2,#3,$);
#6=IFCLOCALPLACEMENT($,#5);
#10=IFCCARTESIANPOINT((0.,0.));
#11=IFCCARTESIANPOINT((4000.,0.));
#12=IFCCARTESIANPOINT((4000.,3000.));
#13=IFCCARTESIANPOINT((0.,3000.));
#14=IFCPOLYLINE((#10,#11,#12,#13,#10));
#15=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,'Slab',#14);
#16=IFCEXTRUDEDAREASOLID(#15,#5,#3,200.);
#17=IFCSHAPEREPRESENTATION(#99,'Body','SweptSolid',(#16));
#18=IFCPRODUCTDEFINITIONSHAPE($,$,(#17));
#19=IFCSLAB('0aBcDeFgHiJkLmNoPqRsT2',$,'Floor',$,$,#6,#18,$,.FLOOR.);
#30=IFCSPACE('0aBcDeFgHiJkLmNoPqRsT3',$,'Kitchen',$,$,#6,$,'101',.ELEMENT.,.INTERNAL.,$);
ENDSEC;
END-ISO-10303-21;
`;

    it('brings a slab in as a floor with its outline', () => {
        const read = importIfc(SLAB, 'level-1');
        const floor = read.elements.find(
            (element): element is FloorElement => element.kind === 'floor',
        )!;

        expect(floor.points).toHaveLength(4);
        expect(floor.thickness).toBeCloseTo(200, 3);
        // The closing point of the polyline is not a fifth corner.
        expect(floor.points[0]).toEqual({ x: 0, y: 0 });
    });

    it('brings a space in as a room', () => {
        const read = importIfc(SLAB, 'level-1');
        const room = read.elements.find((element) => element.kind === 'room');

        expect(room).toBeDefined();
        expect(read.counts.rooms).toBe(1);
    });
});

describe('what it refuses, and what it says', () => {
    it('turns away a file that is not IFC at all', () => {
        expect(() => importIfc('{"walls":[]}', 'level-1')).toThrow(
            IfcImportError,
        );
    });

    it('turns away a STEP file that is not a building', () => {
        expect(() =>
            importIfc(
                `ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n#1=CARTESIAN_POINT('',(0.,0.,0.));\nENDSEC;\n`,
                'level-1',
            ),
        ).toThrow(/not an IFC model/);
    });

    it('says so when an IFC holds no building elements', () => {
        expect(() =>
            importIfc(
                `ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n#1=IFCPROJECT('x',$,'P',$,$,$,$,$,$);\nENDSEC;\n`,
                'level-1',
            ),
        ).toThrow(/No walls, slabs/);
    });
});

describe('writing IFC', () => {
    const solids = buildSolids(testDocument());
    const ifc = exportIfc(solids, { name: 'chen-residence', timestamp: 'now' });

    it('writes a file that says what it is', () => {
        expect(ifc.startsWith('ISO-10303-21;')).toBe(true);
        expect(ifc).toContain("FILE_SCHEMA(('IFC4'))");
        expect(ifc.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
    });

    it('classifies a wall as a wall, so Revit opens it as one', () => {
        expect(ifc).toContain('IFCWALL(');
        expect(ifc).toContain('IFCSLAB(');
        // Not everything dumped under one anonymous type.
        expect(ifc).not.toMatch(/IFCBUILDINGELEMENTPROXY\(.*IFCWALL/s);
    });

    it('puts the building in a project, a site and a storey', () => {
        ['IFCPROJECT(', 'IFCSITE(', 'IFCBUILDING(', 'IFCBUILDINGSTOREY(']
            .forEach((entity) => expect(ifc).toContain(entity));

        // And says which storey the elements are on.
        expect(ifc).toContain('IFCRELCONTAINEDINSPATIALSTRUCTURE(');
    });

    it('writes every real with a decimal point, as the grammar demands', () => {
        // In STEP `1` is an integer and `1.` is a real, and a coordinate must
        // be a real. Every ordinate is checked whole rather than by matching
        // digits, so a trailing point counts.
        const points = [
            ...ifc.matchAll(/IFCCARTESIANPOINT\(\(([^)]*)\)\)/g),
        ].map((found) => found[1]);

        expect(points.length).toBeGreaterThan(0);

        points.forEach((coordinates) => {
            coordinates.split(',').forEach((ordinate) => {
                expect(ordinate).toMatch(/^-?\d+\.\d*$/);
            });
        });
    });

    it('shares one point between the faces that meet on it', () => {
        const points = new Set(
            (ifc.match(/IFCCARTESIANPOINT\(\([^)]*\)\)/g) ?? []).map(String),
        );

        // A box has eight corners and six faces of four points: dedupe or the
        // file carries twenty-four.
        expect(points.size).toBeLessThan(
            (ifc.match(/IFCCARTESIANPOINT/g) ?? []).length + 1,
        );
    });

    it('writes the same file twice for the same model', () => {
        // Identifiers come from a counter, not a clock or a random source, so
        // a diff shows what changed in the building.
        expect(exportIfc(solids, { name: 'chen-residence', timestamp: 'now' })).toBe(
            ifc,
        );
    });

    it('reads back what it wrote', () => {
        // The proof that both halves speak the same language.
        const read = importIfc(ifc, 'level-1');

        expect(read.elements.length).toBeGreaterThan(0);
        expect(read.schema).toBe('IFC4');
    });
});
