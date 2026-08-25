import { faceNormal } from '@/lib/cad/solids';
import type { Solid, Vec3 } from '@/lib/cad/solids';

export type StepOptions = {
    name?: string;
    author?: string;
    organisation?: string;
    /** ISO timestamp written into the header. Passed in so output is reproducible. */
    timestamp?: string;
};

/**
 * ISO 10303-21 part file, AP214 advanced boundary representation.
 *
 * Each solid becomes a `MANIFOLD_SOLID_BREP` over a `CLOSED_SHELL` of planar
 * `ADVANCED_FACE`s. Cartesian points, vertices and edge curves are shared, so
 * an edge between two faces is written once and referenced twice with
 * opposite orientation — which is what makes the result a watertight solid a
 * CAD system can boolean against rather than a bag of triangles.
 *
 * Imported meshes are written the same way. If such a mesh was not closed to
 * begin with, the resulting solid will not be either; nothing here repairs it.
 */
export function exportStep(solids: Solid[], options: StepOptions = {}): string {
    const writer = new StepWriter();
    const name = options.name ?? 'model';

    const context = writer.header();
    const shapes = solids
        .map((solid) => writer.solid(solid))
        .filter((reference): reference is number => reference !== null);

    const representation = writer.add(
        `ADVANCED_BREP_SHAPE_REPRESENTATION('${escape(name)}',(${[
            context.placement,
            ...shapes,
        ]
            .map(reference)
            .join(',')}),${reference(context.geometricContext)})`,
    );

    writer.add(
        `SHAPE_DEFINITION_REPRESENTATION(${reference(context.definitionShape)},${reference(representation)})`,
    );

    return writer.serialise(name, options);
}

class StepWriter {
    private lines: string[] = [];

    private counter = 0;

    private points = new Map<string, number>();

    private vertices = new Map<number, number>();

    private edges = new Map<
        string,
        { id: number; start: number; end: number }
    >();

    add(body: string): number {
        this.counter += 1;
        this.lines.push(`#${this.counter} = ${body};`);

        return this.counter;
    }

    /** Product structure and units, which every reader expects to find first. */
    header(): {
        placement: number;
        geometricContext: number;
        definitionShape: number;
    } {
        const applicationContext = this.add(
            `APPLICATION_CONTEXT('automotive design')`,
        );
        this.add(
            `APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${reference(applicationContext)})`,
        );

        const productContext = this.add(
            `PRODUCT_CONTEXT('',${reference(applicationContext)},'mechanical')`,
        );
        const product = this.add(
            `PRODUCT('model','model','',(${reference(productContext)}))`,
        );
        const formation = this.add(
            `PRODUCT_DEFINITION_FORMATION('','',${reference(product)})`,
        );
        const definitionContext = this.add(
            `PRODUCT_DEFINITION_CONTEXT('part definition',${reference(applicationContext)},'design')`,
        );
        const definition = this.add(
            `PRODUCT_DEFINITION('design','',${reference(formation)},${reference(definitionContext)})`,
        );
        const definitionShape = this.add(
            `PRODUCT_DEFINITION_SHAPE('','',${reference(definition)})`,
        );

        const lengthUnit = this.add(
            `( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )`,
        );
        const angleUnit = this.add(
            `( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )`,
        );
        const solidAngleUnit = this.add(
            `( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )`,
        );
        const uncertainty = this.add(
            `UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.01),${reference(lengthUnit)},'distance_accuracy_value','confusion accuracy')`,
        );
        const geometricContext = this.add(
            `( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${reference(uncertainty)})) GLOBAL_UNIT_ASSIGNED_CONTEXT((${reference(lengthUnit)},${reference(angleUnit)},${reference(solidAngleUnit)})) REPRESENTATION_CONTEXT('','3D') )`,
        );

        const placement = this.axisPlacement(
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 0, z: 1 },
            { x: 1, y: 0, z: 0 },
        );

        return { placement, geometricContext, definitionShape };
    }

    solid(solid: Solid): number | null {
        const faces = solid.faces
            .map((face) => this.face(face))
            .filter((value): value is number => value !== null);

        if (faces.length === 0) {
            return null;
        }

        const shell = this.add(
            `CLOSED_SHELL('',(${faces.map(reference).join(',')}))`,
        );

        return this.add(
            `MANIFOLD_SOLID_BREP('${escape(solid.name)}',${reference(shell)})`,
        );
    }

    private face(face: Vec3[]): number | null {
        if (face.length < 3) {
            return null;
        }

        const normal = faceNormal(face);

        if (normal.x === 0 && normal.y === 0 && normal.z === 0) {
            return null;
        }

        const vertexIds = face.map((vertex) => this.vertex(vertex));
        const orientedEdges: number[] = [];

        for (let index = 0; index < face.length; index++) {
            const from = vertexIds[index];
            const to = vertexIds[(index + 1) % face.length];

            if (from === to) {
                continue;
            }

            const edge = this.edge(
                from,
                to,
                face[index],
                face[(index + 1) % face.length],
            );

            orientedEdges.push(
                this.add(
                    `ORIENTED_EDGE('',*,*,${reference(edge.id)},${edge.start === from ? '.T.' : '.F.'})`,
                ),
            );
        }

        if (orientedEdges.length < 3) {
            return null;
        }

        const loop = this.add(
            `EDGE_LOOP('',(${orientedEdges.map(reference).join(',')}))`,
        );
        const bound = this.add(`FACE_OUTER_BOUND('',${reference(loop)},.T.)`);
        // The reference direction lies in the face, which keeps the plane's
        // local axes consistent with the loop it bounds.
        const inPlane = normalise(subtract(face[1], face[0]));
        const plane = this.add(
            `PLANE('',${reference(this.axisPlacement(face[0], normal, inPlane))})`,
        );

        return this.add(
            `ADVANCED_FACE('',(${reference(bound)}),${reference(plane)},.T.)`,
        );
    }

    private edge(
        from: number,
        to: number,
        start: Vec3,
        end: Vec3,
    ): { id: number; start: number; end: number } {
        const key = from < to ? `${from}:${to}` : `${to}:${from}`;
        const existing = this.edges.get(key);

        if (existing) {
            return existing;
        }

        const direction = this.direction(normalise(subtract(end, start)));
        const vector = this.add(`VECTOR('',${reference(direction)},1.0)`);
        const line = this.add(
            `LINE('',${reference(this.point(start))},${reference(vector)})`,
        );
        const id = this.add(
            `EDGE_CURVE('',${reference(from)},${reference(to)},${reference(line)},.T.)`,
        );
        const record = { id, start: from, end: to };

        this.edges.set(key, record);

        return record;
    }

    private vertex(position: Vec3): number {
        const pointId = this.point(position);
        const existing = this.vertices.get(pointId);

        if (existing) {
            return existing;
        }

        const id = this.add(`VERTEX_POINT('',${reference(pointId)})`);
        this.vertices.set(pointId, id);

        return id;
    }

    private point(position: Vec3): number {
        const key = `${round(position.x)},${round(position.y)},${round(position.z)}`;
        const existing = this.points.get(key);

        if (existing) {
            return existing;
        }

        const id = this.add(
            `CARTESIAN_POINT('',(${real(position.x)},${real(position.y)},${real(position.z)}))`,
        );
        this.points.set(key, id);

        return id;
    }

    private direction(vector: Vec3): number {
        return this.add(
            `DIRECTION('',(${real(vector.x)},${real(vector.y)},${real(vector.z)}))`,
        );
    }

    private axisPlacement(origin: Vec3, axis: Vec3, reference_: Vec3): number {
        return this.add(
            `AXIS2_PLACEMENT_3D('',${reference(this.point(origin))},${reference(
                this.direction(axis),
            )},${reference(this.direction(reference_))})`,
        );
    }

    serialise(name: string, options: StepOptions): string {
        const timestamp = options.timestamp ?? '1970-01-01T00:00:00';

        return [
            'ISO-10303-21;',
            'HEADER;',
            `FILE_DESCRIPTION(('${escape(name)}'),'2;1');`,
            `FILE_NAME('${escape(name)}','${timestamp}',('${escape(
                options.author ?? 'Axon',
            )}'),('${escape(options.organisation ?? 'Axon')}'),` +
                `'Axon','Axon','');`,
            `FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 }'));`,
            'ENDSEC;',
            'DATA;',
            ...this.lines,
            'ENDSEC;',
            'END-ISO-10303-21;',
            '',
        ].join('\n');
    }
}

function reference(id: number): string {
    return `#${id}`;
}

function escape(value: string): string {
    return value.replace(/'/g, "''");
}

/** STEP reals always carry a decimal point. */
function real(value: number): string {
    if (!Number.isFinite(value)) {
        return '0.';
    }

    const rounded = Math.round(value * 1e6) / 1e6;

    return Number.isInteger(rounded) ? `${rounded}.` : String(rounded);
}

function round(value: number): number {
    return Math.round(value * 1000) / 1000;
}

function subtract(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function normalise(vector: Vec3): Vec3 {
    const magnitude = Math.hypot(vector.x, vector.y, vector.z);

    return magnitude < 1e-9
        ? { x: 1, y: 0, z: 0 }
        : {
              x: vector.x / magnitude,
              y: vector.y / magnitude,
              z: vector.z / magnitude,
          };
}
