/**
 * The model document.
 *
 * Every length is stored in millimetres, no matter which units the project
 * displays. Only the formatting layer in `units.ts` knows about feet.
 */

export type Point = { x: number; y: number };

export type Units = 'metric' | 'imperial';

export type Level = {
    id: string;
    name: string;
    elevation: number;
};

export type WallType = {
    id: string;
    name: string;
    thickness: number;
    function: 'exterior' | 'interior' | 'curtain';
};

export type DoorType = {
    id: string;
    name: string;
    width: number;
    height: number;
    leaves: number;
};

export type WindowType = {
    id: string;
    name: string;
    width: number;
    height: number;
    sillHeight: number;
};

export type LocationLine = 'center' | 'left' | 'right';

/** Construction phase, mirroring Revit's phasing. Absent means new. */
export type Phase = 'existing' | 'new' | 'demolished';

/** Which air a duct run carries. */
export type DuctSystem = 'supply' | 'return' | 'exhaust';

/** What a pipe run serves. */
export type PipeSystem = 'domestic' | 'sanitary' | 'hydronic' | 'fire';

/**
 * What a placed component is. One element kind stands in for the loadable
 * families Revit places — equipment, fixtures, furniture and site pieces —
 * with the category driving the plan symbol, the solid and the defaults.
 */
export type FixtureCategory =
    | 'mechanical'
    | 'airTerminal'
    | 'lighting'
    | 'electrical'
    | 'plumbing'
    | 'sprinkler'
    | 'furniture'
    | 'planting'
    | 'parking';

type BaseElement = {
    id: string;
    level: string;
    phase?: Phase;
    /** A pinned element refuses to move, rotate, mirror or stretch. */
    pinned?: boolean;
    /** The Mark: a short label unique to this element, as Revit uses it. */
    mark?: string;
    /** Free-text comments carried on the element. */
    comment?: string;
};

export type WallElement = BaseElement & {
    kind: 'wall';
    typeId: string;
    a: Point;
    b: Point;
    height: number;
    baseOffset: number;
    locationLine: LocationLine;
};

export type DoorElement = BaseElement & {
    kind: 'door';
    typeId: string;
    host: string;
    t: number;
    flipFace: boolean;
    flipHand: boolean;
    /** Instance size, overriding the door type. Absent means follow the type. */
    width?: number;
    height?: number;
};

export type WindowElement = BaseElement & {
    kind: 'window';
    typeId: string;
    host: string;
    t: number;
    flipFace: boolean;
    flipHand: boolean;
    /**
     * Instance size, overriding the window type. Absent means follow the
     * type, so resizing one window never disturbs the rest of its kind.
     */
    width?: number;
    height?: number;
    sillHeight?: number;
};

export type ColumnElement = BaseElement & {
    kind: 'column';
    p: Point;
    size: number;
    rotation: number;
    height: number;
};

export type FloorElement = BaseElement & {
    kind: 'floor';
    points: Point[];
    thickness: number;
    offset: number;
};

export type RoomElement = BaseElement & {
    kind: 'room';
    p: Point;
    name: string;
    number: string;
};

export type DimensionElement = BaseElement & {
    kind: 'dimension';
    a: Point;
    b: Point;
    offset: number;
};

export type TextElement = BaseElement & {
    kind: 'text';
    p: Point;
    value: string;
    size: number;
};

export type LineElement = BaseElement & {
    kind: 'line';
    a: Point;
    b: Point;
};

/**
 * A roof sketched by footprint, the way Revit's Roof by Footprint works.
 * Every edge is slope-defining, so a rectangle produces a hip roof and any
 * other polygon a pavilion pitched toward its centre.
 */
export type RoofElement = BaseElement & {
    kind: 'roof';
    points: Point[];
    /** Pitch of every slope-defining edge, in degrees. */
    slope: number;
    /** Horizontal eave overhang past the sketch, in millimetres. */
    overhang: number;
    /** Height of the eave plate above the level, in millimetres. */
    baseOffset: number;
};

export type CeilingElement = BaseElement & {
    kind: 'ceiling';
    points: Point[];
    /** Height of the finished ceiling above the level, in millimetres. */
    heightOffset: number;
};

/**
 * A straight stair run climbing from `a` on its level to `b` one storey up.
 * Riser count is derived from the rise and the maximum riser height.
 */
export type StairElement = BaseElement & {
    kind: 'stair';
    a: Point;
    b: Point;
    width: number;
    /** Total rise in millimetres, normally the storey height. */
    rise: number;
};

/** A structural grid line with a lettered or numbered bubble at each end. */
export type GridElement = BaseElement & {
    kind: 'grid';
    a: Point;
    b: Point;
    label: string;
};

/** A structural framing member spanning between two points at plate height. */
export type BeamElement = BaseElement & {
    kind: 'beam';
    a: Point;
    b: Point;
    /** Section width in millimetres. */
    width: number;
    /** Section depth below the placement plane, in millimetres. */
    depth: number;
    /** Height of the beam top above the level, in millimetres. */
    elevation: number;
};

/** A datum plane, drawn as a dash-dot line and snappable like a wall. */
export type ReferencePlaneElement = BaseElement & {
    kind: 'referencePlane';
    a: Point;
    b: Point;
    name: string;
};

/** A sloped accessible run between two points, like a stair without steps. */
export type RampElement = BaseElement & {
    kind: 'ramp';
    a: Point;
    b: Point;
    width: number;
    rise: number;
};

/** A revision cloud sketched around changed work. */
export type RevisionCloudElement = BaseElement & {
    kind: 'revisionCloud';
    points: Point[];
    revision: string;
};

/**
 * A section mark. The line runs a''b across the plan; each section
 * derives a section view in the Project Browser, looking from the
 * flag side.
 */
export type SectionElement = BaseElement & {
    kind: 'section';
    a: Point;
    b: Point;
    name: string;
};

/**
 * A mesh brought in from an STL or OBJ file.
 *
 * Triangles are stored flat — nine numbers per triangle — in millimetres and
 * relative to the insertion point, which keeps the document compact and makes
 * placing, rotating and scaling a matter of transforming one anchor.
 */
export type MeshElement = BaseElement & {
    kind: 'mesh';
    name: string;
    p: Point;
    rotation: number;
    scale: number;
    baseOffset: number;
    vertices: number[];
    /** Convex hull in plan, used for drawing and picking. */
    footprint: Point[];
    /** Local bounding box before scaling. */
    size: { x: number; y: number; z: number };
};

/** A guardrail run drawn along its centre line at the level. */
export type RailingElement = BaseElement & {
    kind: 'railing';
    a: Point;
    b: Point;
    height: number;
};

/** A diagonal structural member climbing from `a` up to `b`. */
export type BraceElement = BaseElement & {
    kind: 'brace';
    a: Point;
    b: Point;
    /** Square section size in millimetres. */
    width: number;
    /** Vertical climb from the level at `a` to the top at `b`. */
    rise: number;
};

/** An isolated pad foundation spreading below the level. */
export type FootingElement = BaseElement & {
    kind: 'footing';
    p: Point;
    width: number;
    /** How far the pad reaches below the level, in millimetres. */
    depth: number;
};

/** A run of rectangular duct held at a constant height above the level. */
export type DuctElement = BaseElement & {
    kind: 'duct';
    a: Point;
    b: Point;
    width: number;
    /** Centre line height above the level, in millimetres. */
    elevation: number;
    system: DuctSystem;
};

/** A pipe run held at a constant height above the level. */
export type PipeElement = BaseElement & {
    kind: 'pipe';
    a: Point;
    b: Point;
    diameter: number;
    /** Centre line height above the level, in millimetres. */
    elevation: number;
    system: PipeSystem;
};

/** A cable tray run held at a constant height above the level. */
export type CableTrayElement = BaseElement & {
    kind: 'cableTray';
    a: Point;
    b: Point;
    width: number;
    /** Centre line height above the level, in millimetres. */
    elevation: number;
};

/**
 * A placed component — equipment, a fixture, furniture or a site piece.
 * The footprint is `width` × `depth` centred on `p`, turned by `rotation`.
 */
export type FixtureElement = BaseElement & {
    kind: 'fixture';
    p: Point;
    rotation: number;
    category: FixtureCategory;
    name: string;
    width: number;
    depth: number;
    height: number;
    /** Height of the underside above the level, in millimetres. */
    elevation: number;
};

/** A building pad cut into the site, sketched like a floor. */
export type PadElement = BaseElement & {
    kind: 'pad';
    points: Point[];
    thickness: number;
};

/** A patch of site ground modelled as a flat body below the level. */
export type ToposurfaceElement = BaseElement & {
    kind: 'toposurface';
    points: Point[];
    /** Depth of ground below the level, in millimetres. */
    depth: number;
};

/** The legal site boundary, drawn as a heavy dash-dot loop. */
export type PropertyLineElement = BaseElement & {
    kind: 'propertyLine';
    points: Point[];
};

/** An annotation reporting the level elevation at a point. */
export type SpotElevationElement = BaseElement & {
    kind: 'spotElevation';
    p: Point;
};

/**
 * A camera path sketched through the plan, played back as a first-person
 * tour in the 3D view — Revit's walkthrough, without the keyframe editing.
 */
export type WalkthroughElement = BaseElement & {
    kind: 'walkthrough';
    /** The path walked, in order. Open — the tour does not loop. */
    points: Point[];
    /** Eye height above the level, in millimetres. */
    eyeHeight: number;
};

export type CadElement =
    | WallElement
    | DoorElement
    | WindowElement
    | ColumnElement
    | FloorElement
    | RoomElement
    | DimensionElement
    | TextElement
    | LineElement
    | RoofElement
    | CeilingElement
    | StairElement
    | GridElement
    | BeamElement
    | ReferencePlaneElement
    | RampElement
    | RevisionCloudElement
    | SectionElement
    | MeshElement
    | RailingElement
    | BraceElement
    | FootingElement
    | DuctElement
    | PipeElement
    | CableTrayElement
    | FixtureElement
    | PadElement
    | ToposurfaceElement
    | PropertyLineElement
    | SpotElevationElement
    | WalkthroughElement;

export type ElementKind = CadElement['kind'];

export type OpeningElement = DoorElement | WindowElement;

export type CadDocument = {
    version: number;
    units: Units;
    levels: Level[];
    wallTypes: WallType[];
    doorTypes: DoorType[];
    windowTypes: WindowType[];
    /** Optional so documents saved before templates existed still load. */
    viewTemplates?: ViewTemplate[];
    elements: CadElement[];
    viewSettings: Record<string, Partial<ViewSettings>>;
};

export type ViewKind =
    'plan' | 'ceiling' | 'elevation' | 'section' | 'threeD' | 'schedule';

export type ScheduleKind = 'room' | 'door' | 'window' | 'wall';

export type Orientation = 'north' | 'south' | 'east' | 'west';

export type CadView = {
    id: string;
    name: string;
    kind: ViewKind;
    level?: string;
    orientation?: Orientation;
    schedule?: ScheduleKind;
    /** The section element a section view was derived from. */
    sectionId?: string;
};

export type VisualStyle = 'wireframe' | 'hiddenLine' | 'shaded' | 'realistic';

export type DetailLevel = 'coarse' | 'medium' | 'fine';

export type CropRegion = {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
};

export type ViewSettings = {
    scale: number;
    detailLevel: DetailLevel;
    visualStyle: VisualStyle;
    showGrid: boolean;
    showRooms: boolean;
    showTags: boolean;
    underlay: boolean;
    /** Clip the view to the crop region. */
    cropView: boolean;
    /** Draw the crop boundary even when the crop itself is off. */
    showCrop: boolean;
    /** Cast shadows in the model views. */
    shadows: boolean;
    /**
     * The crop rectangle in millimetres. Null until the view is first cropped,
     * at which point it is seeded from whatever the level contains.
     */
    crop: CropRegion | null;
    /** Which phases draw: everything, only new work, or as-existing. */
    phaseFilter: 'all' | 'new' | 'existing';
    /** Categories switched off in this view, as Visibility/Graphics does. */
    hiddenCategories: ElementKind[];
};

/** A named bundle of view settings, applied like Revit's view templates. */
export type ViewTemplate = {
    id: string;
    name: string;
    settings: Partial<ViewSettings>;
};

/**
 * Tools available on the ribbon. `select` is the resting state, everything
 * else is a placement or modification mode.
 */
export type ToolId =
    | 'select'
    | 'wall'
    | 'door'
    | 'window'
    | 'column'
    | 'floor'
    | 'room'
    | 'dimension'
    | 'text'
    | 'line'
    | 'roof'
    | 'ceiling'
    | 'stair'
    | 'grid'
    | 'beam'
    | 'referencePlane'
    | 'ramp'
    | 'revisionCloud'
    | 'section'
    | 'railing'
    | 'brace'
    | 'footing'
    | 'duct'
    | 'pipe'
    | 'cableTray'
    | 'fixture'
    | 'pad'
    | 'toposurface'
    | 'propertyLine'
    | 'spotElevation'
    | 'walkthrough'
    | 'move'
    | 'copy'
    | 'rotate'
    | 'mirror'
    | 'align'
    | 'trim'
    | 'split'
    | 'offset'
    | 'array'
    | 'measure';

export type DrawMode = 'line' | 'rectangle' | 'polygon';

export type SnapKind =
    | 'endpoint'
    | 'midpoint'
    | 'intersection'
    | 'perpendicular'
    | 'nearest'
    | 'grid'
    | 'ortho'
    | 'free';

export type SnapResult = {
    point: Point;
    kind: SnapKind;
    reference?: string;
};

export type Camera = {
    /** Millimetres of model per screen pixel is `1 / zoom`. */
    zoom: number;
    /** World point displayed at the centre of the viewport. */
    center: Point;
};

export type OrbitCamera = {
    azimuth: number;
    elevation: number;
    distance: number;
    target: { x: number; y: number; z: number };
};

/**
 * A first-person camera: the eye itself, aimed by yaw and pitch. Yaw follows
 * the plan convention (0 east, counter-clockwise); pitch is up-positive.
 */
export type WalkCamera = {
    eye: { x: number; y: number; z: number };
    yaw: number;
    pitch: number;
};
