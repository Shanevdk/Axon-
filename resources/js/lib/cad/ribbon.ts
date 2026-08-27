import {
    AirVent,
    AppWindow,
    Armchair,
    ArrowDownToLine,
    Baseline,
    Blinds,
    Box,
    BoxSelect,
    BrickWall,
    Cable,
    Camera,
    Car,
    CloudDrizzle,
    HardDriveDownload,
    Columns3,
    Compass,
    Construction,
    Copy,
    CopyPlus,
    Crosshair,
    DoorOpen,
    Droplets,
    Eye,
    EyeOff,
    Fan,
    Fence,
    FileUp,
    Footprints,
    FlipHorizontal2,
    Focus,
    Grid2x2,
    Grid3x3,
    Home,
    Info,
    LandPlot,
    Layers,
    Lightbulb,
    Magnet,
    MessageCircle,
    Mountain,
    Move3d,
    Maximize,
    MousePointer2,
    Move,
    MoveUpRight,
    PackageCheck,
    PackageOpen,
    PenLine,
    PersonStanding,
    Play,
    RectangleHorizontal,
    Redo2,
    Route,
    RotateCw,
    Ruler,
    Save,
    Scan,
    Scissors,
    Pin,
    PinOff,
    Pipette,
    Recycle,
    Settings2,
    ShieldQuestion,
    ShowerHead,
    TriangleAlert,
    Wand2,
    Spline,
    Square,
    SquareStack,
    StretchHorizontal,
    Sun,
    Table2,
    TrainTrack,
    Trash2,
    TreeDeciduous,
    Type,
    Undo2,
    Wind,
    Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { FixtureCategory, ToolId } from '@/lib/cad/types';

export type CommandId =
    | 'undo'
    | 'redo'
    | 'save'
    | 'delete'
    | 'zoomFit'
    | 'addLevel'
    | 'projectInfo'
    | 'openThreeD'
    | 'openSchedule'
    | 'import'
    | 'exportModel'
    | 'exportTypes'
    | 'export'
    | 'render'
    | 'askAssistant'
    | 'pinSelection'
    | 'unpinSelection'
    | 'createSimilar'
    | 'matchType'
    | 'reviewWarnings'
    | 'purgeUnused'
    | 'cleanUpModel'
    | 'openLibrary'
    | 'downloadDrawing'
    | 'hideElement'
    | 'isolateElement'
    | 'resetHideIsolate'
    | 'playTour'
    | 'selectAll'
    | 'styleWireframe'
    | 'styleHiddenLine'
    | 'styleShaded'
    | 'styleRealistic';

export type ToggleId =
    | 'showGrid'
    | 'showRooms'
    | 'showTags'
    | 'underlay'
    | 'ortho'
    | 'snaps'
    | 'cropView'
    | 'showCrop'
    | 'shadows'
    | 'revealHidden'
    | 'walkMode';

export type RibbonAction =
    | {
          kind: 'tool';
          tool: ToolId;
          /** Component category the fixture tool arms with, when set. */
          fixture?: FixtureCategory;
      }
    | { kind: 'command'; command: CommandId }
    | { kind: 'toggle'; setting: ToggleId };

export type RibbonButton = {
    id: string;
    label: string;
    icon: LucideIcon;
    action: RibbonAction;
    size?: 'large' | 'small';
    shortcut?: string;
    hint?: string;
};

export type RibbonPanel = {
    id: string;
    title: string;
    buttons: RibbonButton[];
};

export type RibbonTab = {
    id: string;
    title: string;
    panels: RibbonPanel[];
    /** Contextual tabs appear only while something is selected. */
    contextual?: boolean;
};

export const RIBBON_TABS: RibbonTab[] = [
    {
        id: 'architecture',
        title: 'Architecture',
        panels: [
            {
                id: 'build',
                title: 'Build',
                buttons: [
                    {
                        id: 'wall',
                        label: 'Wall',
                        icon: BrickWall,
                        action: { kind: 'tool', tool: 'wall' },
                        size: 'large',
                        shortcut: 'WA',
                        hint: 'Draw a wall between two points',
                    },
                    {
                        id: 'door',
                        label: 'Door',
                        icon: DoorOpen,
                        action: { kind: 'tool', tool: 'door' },
                        size: 'large',
                        shortcut: 'DR',
                        hint: 'Place a door in a wall',
                    },
                    {
                        id: 'window',
                        label: 'Window',
                        icon: AppWindow,
                        action: { kind: 'tool', tool: 'window' },
                        size: 'large',
                        shortcut: 'WN',
                        hint: 'Place a window in a wall',
                    },
                    {
                        id: 'column',
                        label: 'Column',
                        icon: Columns3,
                        action: { kind: 'tool', tool: 'column' },
                        size: 'large',
                        shortcut: 'CL',
                    },
                    {
                        id: 'floor',
                        label: 'Floor',
                        icon: Square,
                        action: { kind: 'tool', tool: 'floor' },
                        size: 'large',
                        hint: 'Sketch a floor boundary, close it to finish',
                    },
                    {
                        id: 'roof',
                        label: 'Roof',
                        icon: Home,
                        action: { kind: 'tool', tool: 'roof' },
                        size: 'large',
                        shortcut: 'RF',
                        hint: 'Sketch the roof footprint — every edge is slope-defining',
                    },
                    {
                        id: 'ceiling',
                        label: 'Ceiling',
                        icon: Grid3x3,
                        action: { kind: 'tool', tool: 'ceiling' },
                        size: 'small',
                        shortcut: 'CE',
                        hint: 'Sketch a ceiling — visible in ceiling plans',
                    },
                    {
                        id: 'stair',
                        label: 'Stair',
                        icon: TrainTrack,
                        action: { kind: 'tool', tool: 'stair' },
                        size: 'small',
                        shortcut: 'SR',
                        hint: 'Two clicks along the run, climbing to the level above',
                    },
                    {
                        id: 'ramp',
                        label: 'Ramp',
                        icon: Route,
                        action: { kind: 'tool', tool: 'ramp' },
                        size: 'small',
                        shortcut: 'RA',
                        hint: 'Sloped run between two points',
                    },
                    {
                        id: 'railing',
                        label: 'Railing',
                        icon: Fence,
                        action: { kind: 'tool', tool: 'railing' },
                        size: 'small',
                        shortcut: 'RL',
                        hint: 'Guardrail between two points — posts are automatic',
                    },
                    {
                        id: 'component',
                        label: 'Component',
                        icon: Armchair,
                        action: {
                            kind: 'tool',
                            tool: 'fixture',
                            fixture: 'furniture',
                        },
                        size: 'small',
                        shortcut: 'CM',
                        hint: 'Place furniture or another loadable component',
                    },
                ],
            },
            {
                id: 'room-area',
                title: 'Room & Area',
                buttons: [
                    {
                        id: 'room',
                        label: 'Room',
                        icon: Scan,
                        action: { kind: 'tool', tool: 'room' },
                        size: 'large',
                        shortcut: 'RM',
                        hint: 'Tag an enclosed space',
                    },
                    {
                        id: 'separator',
                        label: 'Separator',
                        icon: Spline,
                        action: { kind: 'tool', tool: 'line' },
                        size: 'small',
                    },
                    {
                        id: 'tags',
                        label: 'Tags',
                        icon: Baseline,
                        action: { kind: 'toggle', setting: 'showTags' },
                        size: 'small',
                    },
                ],
            },
            {
                id: 'datum',
                title: 'Datum',
                buttons: [
                    {
                        id: 'level',
                        label: 'Level',
                        icon: Layers,
                        action: { kind: 'command', command: 'addLevel' },
                        size: 'large',
                        hint: 'Add a storey above the highest level',
                    },
                    {
                        id: 'underlay',
                        label: 'Underlay',
                        icon: Blinds,
                        action: { kind: 'toggle', setting: 'underlay' },
                        size: 'small',
                    },
                    {
                        id: 'reference-plane',
                        label: 'Ref Plane',
                        icon: Move3d,
                        action: { kind: 'tool', tool: 'referencePlane' },
                        size: 'small',
                        shortcut: 'RP',
                        hint: 'Datum plane to sketch and align against',
                    },
                ],
            },
        ],
    },
    {
        id: 'structure',
        title: 'Structure',
        panels: [
            {
                id: 'structure-build',
                title: 'Structure',
                buttons: [
                    {
                        id: 'structural-wall',
                        label: 'Wall',
                        icon: BrickWall,
                        action: { kind: 'tool', tool: 'wall' },
                        size: 'large',
                    },
                    {
                        id: 'structural-column',
                        label: 'Column',
                        icon: Columns3,
                        action: { kind: 'tool', tool: 'column' },
                        size: 'large',
                    },
                    {
                        id: 'slab',
                        label: 'Slab',
                        icon: Square,
                        action: { kind: 'tool', tool: 'floor' },
                        size: 'large',
                    },
                    {
                        id: 'beam',
                        label: 'Beam',
                        icon: Construction,
                        action: { kind: 'tool', tool: 'beam' },
                        size: 'large',
                        shortcut: 'BM',
                        hint: 'Structural framing between two supports at plate height',
                    },
                    {
                        id: 'brace',
                        label: 'Brace',
                        icon: MoveUpRight,
                        action: { kind: 'tool', tool: 'brace' },
                        size: 'large',
                        shortcut: 'BR',
                        hint: 'Diagonal member climbing to the level above',
                    },
                    {
                        id: 'structural-grid',
                        label: 'Grid',
                        icon: Grid2x2,
                        action: { kind: 'tool', tool: 'grid' },
                        size: 'large',
                        shortcut: 'GL',
                        hint: 'Datum line with a bubble at each end',
                    },
                ],
            },
            {
                id: 'foundation',
                title: 'Foundation',
                buttons: [
                    {
                        id: 'footing',
                        label: 'Isolated',
                        icon: ArrowDownToLine,
                        action: { kind: 'tool', tool: 'footing' },
                        size: 'large',
                        shortcut: 'FT',
                        hint: 'Pad footing spreading below the level',
                    },
                ],
            },
            {
                id: 'structure-model',
                title: 'Model',
                buttons: [
                    {
                        id: 'structure-3d',
                        label: '3D View',
                        icon: Box,
                        action: { kind: 'command', command: 'openThreeD' },
                        size: 'large',
                    },
                ],
            },
        ],
    },
    {
        id: 'systems',
        title: 'Systems',
        panels: [
            {
                id: 'hvac',
                title: 'HVAC',
                buttons: [
                    {
                        id: 'duct',
                        label: 'Duct',
                        icon: Wind,
                        action: { kind: 'tool', tool: 'duct' },
                        size: 'large',
                        shortcut: 'DT',
                        hint: 'Rectangular duct run between two points',
                    },
                    {
                        id: 'air-terminal',
                        label: 'Air Terminal',
                        icon: AirVent,
                        action: {
                            kind: 'tool',
                            tool: 'fixture',
                            fixture: 'airTerminal',
                        },
                        size: 'small',
                        shortcut: 'AT',
                        hint: 'Ceiling diffuser or grille',
                    },
                    {
                        id: 'mechanical-equipment',
                        label: 'Equipment',
                        icon: Fan,
                        action: {
                            kind: 'tool',
                            tool: 'fixture',
                            fixture: 'mechanical',
                        },
                        size: 'small',
                        shortcut: 'ME',
                        hint: 'Air handler, fan or other mechanical equipment',
                    },
                ],
            },
            {
                id: 'plumbing',
                title: 'Plumbing',
                buttons: [
                    {
                        id: 'pipe',
                        label: 'Pipe',
                        icon: Droplets,
                        action: { kind: 'tool', tool: 'pipe' },
                        size: 'large',
                        shortcut: 'PP',
                        hint: 'Pipe run between two points, coloured by system',
                    },
                    {
                        id: 'plumbing-fixture',
                        label: 'Fixture',
                        icon: ShowerHead,
                        action: {
                            kind: 'tool',
                            tool: 'fixture',
                            fixture: 'plumbing',
                        },
                        size: 'small',
                        shortcut: 'PF',
                        hint: 'Basin, WC or other plumbing fixture',
                    },
                    {
                        id: 'sprinkler',
                        label: 'Sprinkler',
                        icon: CloudDrizzle,
                        action: {
                            kind: 'tool',
                            tool: 'fixture',
                            fixture: 'sprinkler',
                        },
                        size: 'small',
                        shortcut: 'SK',
                        hint: 'Sprinkler head at the ceiling',
                    },
                ],
            },
            {
                id: 'electrical',
                title: 'Electrical',
                buttons: [
                    {
                        id: 'cable-tray',
                        label: 'Cable Tray',
                        icon: Cable,
                        action: { kind: 'tool', tool: 'cableTray' },
                        size: 'large',
                        shortcut: 'CT',
                        hint: 'Ladder tray run between two points',
                    },
                    {
                        id: 'lighting-fixture',
                        label: 'Lighting',
                        icon: Lightbulb,
                        action: {
                            kind: 'tool',
                            tool: 'fixture',
                            fixture: 'lighting',
                        },
                        size: 'small',
                        shortcut: 'LF',
                        hint: 'Luminaire at the ceiling',
                    },
                    {
                        id: 'electrical-panel',
                        label: 'Panel',
                        icon: Zap,
                        action: {
                            kind: 'tool',
                            tool: 'fixture',
                            fixture: 'electrical',
                        },
                        size: 'small',
                        shortcut: 'PB',
                        hint: 'Panelboard or other electrical equipment',
                    },
                ],
            },
        ],
    },
    {
        id: 'annotate',
        title: 'Annotate',
        panels: [
            {
                id: 'dimension',
                title: 'Dimension',
                buttons: [
                    {
                        id: 'aligned',
                        label: 'Aligned',
                        icon: Ruler,
                        action: { kind: 'tool', tool: 'dimension' },
                        size: 'large',
                        shortcut: 'DI',
                        hint: 'Dimension between two points',
                    },
                    {
                        id: 'measure',
                        label: 'Measure',
                        icon: Ruler,
                        action: { kind: 'tool', tool: 'measure' },
                        size: 'small',
                        shortcut: 'MS',
                    },
                    {
                        id: 'spot-elevation',
                        label: 'Spot Elev',
                        icon: Crosshair,
                        action: { kind: 'tool', tool: 'spotElevation' },
                        size: 'small',
                        shortcut: 'SP',
                        hint: 'Target reporting the level height at a point',
                    },
                ],
            },
            {
                id: 'text',
                title: 'Text',
                buttons: [
                    {
                        id: 'text-note',
                        label: 'Text',
                        icon: Type,
                        action: { kind: 'tool', tool: 'text' },
                        size: 'large',
                        shortcut: 'TX',
                    },
                    {
                        id: 'detail-line',
                        label: 'Detail Line',
                        icon: PenLine,
                        action: { kind: 'tool', tool: 'line' },
                        size: 'small',
                        shortcut: 'DL',
                    },
                    {
                        id: 'revision-cloud',
                        label: 'Rev Cloud',
                        icon: MessageCircle,
                        action: { kind: 'tool', tool: 'revisionCloud' },
                        size: 'small',
                        shortcut: 'RC',
                        hint: 'Sketch around changed work; close it to finish',
                    },
                ],
            },
        ],
    },
    {
        id: 'site',
        title: 'Massing & Site',
        panels: [
            {
                id: 'model-site',
                title: 'Model Site',
                buttons: [
                    {
                        id: 'toposurface',
                        label: 'Toposurface',
                        icon: Mountain,
                        action: { kind: 'tool', tool: 'toposurface' },
                        size: 'large',
                        shortcut: 'TS',
                        hint: 'Sketch the site ground — close it to finish',
                    },
                    {
                        id: 'building-pad',
                        label: 'Pad',
                        icon: RectangleHorizontal,
                        action: { kind: 'tool', tool: 'pad' },
                        size: 'small',
                        shortcut: 'PD',
                        hint: 'Building pad cut into the site',
                    },
                    {
                        id: 'property-line',
                        label: 'Property Line',
                        icon: LandPlot,
                        action: { kind: 'tool', tool: 'propertyLine' },
                        size: 'small',
                        shortcut: 'PL',
                        hint: 'Sketch the legal boundary of the site',
                    },
                ],
            },
            {
                id: 'site-components',
                title: 'Site Components',
                buttons: [
                    {
                        id: 'planting',
                        label: 'Planting',
                        icon: TreeDeciduous,
                        action: {
                            kind: 'tool',
                            tool: 'fixture',
                            fixture: 'planting',
                        },
                        size: 'large',
                        shortcut: 'PT',
                        hint: 'Place a tree — canopy and trunk are automatic',
                    },
                    {
                        id: 'parking',
                        label: 'Parking',
                        icon: Car,
                        action: {
                            kind: 'tool',
                            tool: 'fixture',
                            fixture: 'parking',
                        },
                        size: 'small',
                        shortcut: 'PK',
                        hint: 'Parking stall, open at the aisle end',
                    },
                    {
                        id: 'site-component',
                        label: 'Component',
                        icon: Armchair,
                        action: {
                            kind: 'tool',
                            tool: 'fixture',
                            fixture: 'furniture',
                        },
                        size: 'small',
                        hint: 'Site furniture or another placed component',
                    },
                ],
            },
        ],
    },
    {
        id: 'modify',
        title: 'Modify',
        panels: [
            {
                id: 'select',
                title: 'Select',
                buttons: [
                    {
                        id: 'modify',
                        label: 'Modify',
                        icon: MousePointer2,
                        action: { kind: 'tool', tool: 'select' },
                        size: 'large',
                        shortcut: 'Esc',
                    },
                ],
            },
            {
                id: 'geometry',
                title: 'Modify',
                buttons: [
                    {
                        id: 'move',
                        label: 'Move',
                        icon: Move,
                        action: { kind: 'tool', tool: 'move' },
                        size: 'large',
                        shortcut: 'MV',
                    },
                    {
                        id: 'copy',
                        label: 'Copy',
                        icon: Copy,
                        action: { kind: 'tool', tool: 'copy' },
                        size: 'large',
                        shortcut: 'CO',
                    },
                    {
                        id: 'rotate',
                        label: 'Rotate',
                        icon: RotateCw,
                        action: { kind: 'tool', tool: 'rotate' },
                        size: 'large',
                        shortcut: 'RO',
                    },
                    {
                        id: 'mirror',
                        label: 'Mirror',
                        icon: FlipHorizontal2,
                        action: { kind: 'tool', tool: 'mirror' },
                        size: 'large',
                        shortcut: 'MM',
                    },
                    {
                        id: 'trim',
                        label: 'Trim',
                        icon: Scissors,
                        action: { kind: 'tool', tool: 'trim' },
                        size: 'small',
                        shortcut: 'TR',
                        hint: 'Trim or extend two walls to a corner',
                    },
                    {
                        id: 'split',
                        label: 'Split',
                        icon: Spline,
                        action: { kind: 'tool', tool: 'split' },
                        size: 'small',
                        shortcut: 'SL',
                        hint: 'Split a wall where you click',
                    },
                    {
                        id: 'align',
                        label: 'Align',
                        icon: StretchHorizontal,
                        action: { kind: 'tool', tool: 'align' },
                        size: 'small',
                        shortcut: 'AL',
                        hint: 'Make a wall collinear with a reference wall',
                    },
                    {
                        id: 'offset',
                        label: 'Offset',
                        icon: Copy,
                        action: { kind: 'tool', tool: 'offset' },
                        size: 'small',
                        shortcut: 'OF',
                        hint: 'Parallel-copy a wall at the offset distance',
                    },
                    {
                        id: 'array',
                        label: 'Array',
                        icon: SquareStack,
                        action: { kind: 'tool', tool: 'array' },
                        size: 'small',
                        shortcut: 'AR',
                        hint: 'Copy the selection at even spacing along a picked step',
                    },
                    {
                        id: 'pin',
                        label: 'Pin',
                        icon: Pin,
                        action: { kind: 'command', command: 'pinSelection' },
                        size: 'small',
                        shortcut: 'PN',
                        hint: 'Pin the selection so nothing can move it',
                    },
                    {
                        id: 'unpin',
                        label: 'Unpin',
                        icon: PinOff,
                        action: { kind: 'command', command: 'unpinSelection' },
                        size: 'small',
                        shortcut: 'UP',
                    },
                    {
                        id: 'match-type',
                        label: 'Match',
                        icon: Pipette,
                        action: { kind: 'command', command: 'matchType' },
                        size: 'small',
                        shortcut: 'MT',
                        hint: 'Give every selected element the first one’s type',
                    },
                    {
                        id: 'create-similar',
                        label: 'Similar',
                        icon: CopyPlus,
                        action: { kind: 'command', command: 'createSimilar' },
                        size: 'small',
                        shortcut: 'CS',
                        hint: 'Arm the tool that places more like the selection',
                    },
                    {
                        id: 'delete',
                        label: 'Delete',
                        icon: Trash2,
                        action: { kind: 'command', command: 'delete' },
                        size: 'large',
                        shortcut: 'Del',
                    },
                ],
            },
            {
                id: 'history',
                title: 'History',
                buttons: [
                    {
                        id: 'undo',
                        label: 'Undo',
                        icon: Undo2,
                        action: { kind: 'command', command: 'undo' },
                        size: 'small',
                        shortcut: 'Ctrl+Z',
                    },
                    {
                        id: 'redo',
                        label: 'Redo',
                        icon: Redo2,
                        action: { kind: 'command', command: 'redo' },
                        size: 'small',
                        shortcut: 'Ctrl+Y',
                    },
                    {
                        id: 'save',
                        label: 'Save',
                        icon: Save,
                        action: { kind: 'command', command: 'save' },
                        size: 'small',
                        shortcut: 'Ctrl+S',
                    },
                ],
            },
        ],
    },
    {
        id: 'view',
        title: 'View',
        panels: [
            {
                id: 'graphics',
                title: 'Graphics',
                buttons: [
                    {
                        id: 'zoom-fit',
                        label: 'Zoom Fit',
                        icon: Maximize,
                        action: { kind: 'command', command: 'zoomFit' },
                        size: 'large',
                        shortcut: 'ZF',
                    },
                    {
                        id: 'grid',
                        label: 'Grid',
                        icon: Grid2x2,
                        action: { kind: 'toggle', setting: 'showGrid' },
                        size: 'small',
                    },
                    {
                        id: 'rooms',
                        label: 'Room Fill',
                        icon: Sun,
                        action: { kind: 'toggle', setting: 'showRooms' },
                        size: 'small',
                    },
                    {
                        id: 'snaps',
                        label: 'Snaps',
                        icon: Magnet,
                        action: { kind: 'toggle', setting: 'snaps' },
                        size: 'small',
                    },
                ],
            },
            {
                id: 'create-view',
                title: 'Create',
                buttons: [
                    {
                        id: 'three-d',
                        label: '3D View',
                        icon: Box,
                        action: { kind: 'command', command: 'openThreeD' },
                        size: 'large',
                    },
                    {
                        id: 'section',
                        label: 'Section',
                        icon: Scissors,
                        action: { kind: 'tool', tool: 'section' },
                        size: 'small',
                        shortcut: 'SE',
                        hint: 'Draw a section line; the view appears in the browser',
                    },
                    {
                        id: 'elevation',
                        label: 'Elevation',
                        icon: Compass,
                        action: { kind: 'command', command: 'openThreeD' },
                        size: 'small',
                    },
                    {
                        id: 'schedule',
                        label: 'Schedule',
                        icon: Table2,
                        action: { kind: 'command', command: 'openSchedule' },
                        size: 'small',
                    },
                ],
            },
            {
                id: 'walkthrough-panel',
                title: 'Walkthrough',
                buttons: [
                    {
                        id: 'first-person',
                        label: 'First Person',
                        icon: PersonStanding,
                        action: { kind: 'toggle', setting: 'walkMode' },
                        size: 'large',
                        shortcut: 'FP',
                        hint: 'Walk the model at eye height — WASD to move, drag to look, Esc to exit',
                    },
                    {
                        id: 'walkthrough',
                        label: 'Path',
                        icon: Footprints,
                        action: { kind: 'tool', tool: 'walkthrough' },
                        size: 'small',
                        shortcut: 'WT',
                        hint: 'Sketch a camera path in plan; press Enter to finish',
                    },
                    {
                        id: 'play-tour',
                        label: 'Play Tour',
                        icon: Play,
                        action: { kind: 'command', command: 'playTour' },
                        size: 'small',
                        shortcut: 'PW',
                        hint: 'Walk the camera along the walkthrough path',
                    },
                ],
            },
        ],
    },
    {
        id: 'insert',
        title: 'Insert',
        panels: [
            {
                id: 'import',
                title: 'Import',
                buttons: [
                    {
                        id: 'open-library',
                        label: 'Library',
                        icon: Armchair,
                        action: { kind: 'command', command: 'openLibrary' },
                        size: 'large',
                        shortcut: 'LB',
                        hint: 'Place a couch, a table, anything the studio has shelved',
                    },
                    {
                        id: 'import-file',
                        label: 'Import',
                        icon: FileUp,
                        action: { kind: 'command', command: 'import' },
                        size: 'large',
                        hint: 'Bring in a DXF drawing, an STL or OBJ mesh, a type library or another model',
                    },
                    {
                        id: 'link-cad',
                        label: 'Link CAD',
                        icon: Spline,
                        action: { kind: 'command', command: 'import' },
                        size: 'small',
                    },
                    {
                        id: 'load-family',
                        label: 'Load Types',
                        icon: PackageOpen,
                        action: { kind: 'command', command: 'import' },
                        size: 'small',
                    },
                ],
            },
            {
                id: 'export',
                title: 'Export',
                buttons: [
                    {
                        id: 'export-model',
                        label: 'Export',
                        icon: PackageCheck,
                        action: { kind: 'command', command: 'exportModel' },
                        size: 'large',
                        hint: 'Write the model out as STEP, STL, OBJ, DXF or an Axon model file',
                    },
                    {
                        id: 'download-drawing',
                        label: 'Download Drawing',
                        icon: HardDriveDownload,
                        action: { kind: 'command', command: 'downloadDrawing' },
                        size: 'small',
                        hint: 'Save the whole model as a file, to carry it to another computer',
                    },
                    {
                        id: 'export-types',
                        label: 'Save Types',
                        icon: Save,
                        action: { kind: 'command', command: 'exportTypes' },
                        size: 'small',
                        hint: 'Save this project’s wall, door and window types as a reusable library',
                    },
                    {
                        id: 'export-view-image',
                        label: 'Image',
                        icon: Maximize,
                        action: { kind: 'command', command: 'export' },
                        size: 'small',
                    },
                    {
                        id: 'render-design',
                        label: 'Render',
                        icon: Camera,
                        action: { kind: 'command', command: 'render' },
                        size: 'large',
                        hint: 'Photograph the design — a brief measured off the model, sent to an image generator',
                    },
                    {
                        id: 'ask-assistant',
                        label: 'Ask',
                        icon: ShieldQuestion,
                        action: { kind: 'command', command: 'askAssistant' },
                        size: 'large',
                        hint: 'Ask about this building, and about the fire and building code where it is being built',
                    },
                ],
            },
        ],
    },
    {
        id: 'manage',
        title: 'Manage',
        panels: [
            {
                id: 'settings',
                title: 'Settings',
                buttons: [
                    {
                        id: 'project-info',
                        label: 'Project Information',
                        icon: Info,
                        action: { kind: 'command', command: 'projectInfo' },
                        size: 'large',
                    },
                    {
                        id: 'project-units',
                        label: 'Units',
                        icon: Settings2,
                        action: { kind: 'command', command: 'projectInfo' },
                        size: 'small',
                    },
                ],
            },
            {
                id: 'inquiry',
                title: 'Inquiry',
                buttons: [
                    {
                        id: 'review-warnings',
                        label: 'Warnings',
                        icon: TriangleAlert,
                        action: { kind: 'command', command: 'reviewWarnings' },
                        size: 'large',
                        shortcut: 'WR',
                        hint: 'Review everything the model quietly disagrees with',
                    },
                    {
                        id: 'clean-up-model',
                        label: 'Clean Up',
                        icon: Wand2,
                        action: { kind: 'command', command: 'cleanUpModel' },
                        size: 'large',
                        shortcut: 'CX',
                        hint: 'Fix rough edges — close open corners, square slipped walls, remove slivers and duplicates',
                    },
                    {
                        id: 'purge-unused',
                        label: 'Purge',
                        icon: Recycle,
                        action: { kind: 'command', command: 'purgeUnused' },
                        size: 'small',
                        hint: 'Drop wall, door and window types nothing uses',
                    },
                ],
            },
            {
                id: 'export',
                title: 'Export',
                buttons: [
                    {
                        id: 'export-image',
                        label: 'Export Image',
                        icon: Save,
                        action: { kind: 'command', command: 'export' },
                        size: 'large',
                        hint: 'Save the active view as a PNG',
                    },
                ],
            },
        ],
    },
];

/**
 * Keyboard accelerators, using Revit's two-letter pairs.
 *
 * Anything the ribbon can do can be bound here, so the same dispatch handles
 * tools, commands and view toggles.
 */
export const SHORTCUTS: Record<string, RibbonAction> = {
    // Build
    wa: { kind: 'tool', tool: 'wall' },
    dr: { kind: 'tool', tool: 'door' },
    wn: { kind: 'tool', tool: 'window' },
    cl: { kind: 'tool', tool: 'column' },
    rm: { kind: 'tool', tool: 'room' },
    ll: { kind: 'command', command: 'addLevel' },

    rf: { kind: 'tool', tool: 'roof' },
    ce: { kind: 'tool', tool: 'ceiling' },
    sr: { kind: 'tool', tool: 'stair' },
    gl: { kind: 'tool', tool: 'grid' },
    bm: { kind: 'tool', tool: 'beam' },
    ra: { kind: 'tool', tool: 'ramp' },
    rl: { kind: 'tool', tool: 'railing' },
    rp: { kind: 'tool', tool: 'referencePlane' },
    rc: { kind: 'tool', tool: 'revisionCloud' },
    se: { kind: 'tool', tool: 'section' },
    cm: { kind: 'tool', tool: 'fixture', fixture: 'furniture' },

    // Structure
    br: { kind: 'tool', tool: 'brace' },
    ft: { kind: 'tool', tool: 'footing' },

    // Systems
    dt: { kind: 'tool', tool: 'duct' },
    at: { kind: 'tool', tool: 'fixture', fixture: 'airTerminal' },
    me: { kind: 'tool', tool: 'fixture', fixture: 'mechanical' },
    pp: { kind: 'tool', tool: 'pipe' },
    pf: { kind: 'tool', tool: 'fixture', fixture: 'plumbing' },
    sk: { kind: 'tool', tool: 'fixture', fixture: 'sprinkler' },
    ct: { kind: 'tool', tool: 'cableTray' },
    lf: { kind: 'tool', tool: 'fixture', fixture: 'lighting' },
    pb: { kind: 'tool', tool: 'fixture', fixture: 'electrical' },

    // Massing & Site
    ts: { kind: 'tool', tool: 'toposurface' },
    pd: { kind: 'tool', tool: 'pad' },
    pl: { kind: 'tool', tool: 'propertyLine' },
    pt: { kind: 'tool', tool: 'fixture', fixture: 'planting' },
    pk: { kind: 'tool', tool: 'fixture', fixture: 'parking' },

    // Walkthrough
    wt: { kind: 'tool', tool: 'walkthrough' },
    fp: { kind: 'toggle', setting: 'walkMode' },
    pw: { kind: 'command', command: 'playTour' },

    // Annotate
    di: { kind: 'tool', tool: 'dimension' },
    tx: { kind: 'tool', tool: 'text' },
    dl: { kind: 'tool', tool: 'line' },
    ms: { kind: 'tool', tool: 'measure' },
    sp: { kind: 'tool', tool: 'spotElevation' },

    // Modify
    md: { kind: 'tool', tool: 'select' },
    mv: { kind: 'tool', tool: 'move' },
    pn: { kind: 'command', command: 'pinSelection' },
    up: { kind: 'command', command: 'unpinSelection' },
    mt: { kind: 'command', command: 'matchType' },
    cs: { kind: 'command', command: 'createSimilar' },
    wr: { kind: 'command', command: 'reviewWarnings' },
    cx: { kind: 'command', command: 'cleanUpModel' },
    lb: { kind: 'command', command: 'openLibrary' },
    co: { kind: 'tool', tool: 'copy' },
    cc: { kind: 'tool', tool: 'copy' },
    ro: { kind: 'tool', tool: 'rotate' },
    mm: { kind: 'tool', tool: 'mirror' },
    de: { kind: 'command', command: 'delete' },
    tr: { kind: 'tool', tool: 'trim' },
    sl: { kind: 'tool', tool: 'split' },
    al: { kind: 'tool', tool: 'align' },
    of: { kind: 'tool', tool: 'offset' },
    ar: { kind: 'tool', tool: 'array' },
    sa: { kind: 'command', command: 'selectAll' },

    // View
    zf: { kind: 'command', command: 'zoomFit' },
    ze: { kind: 'command', command: 'zoomFit' },
    za: { kind: 'command', command: 'zoomFit' },
    wf: { kind: 'command', command: 'styleWireframe' },
    hl: { kind: 'command', command: 'styleHiddenLine' },
    sd: { kind: 'command', command: 'styleShaded' },
    rr: { kind: 'command', command: 'styleRealistic' },
    gr: { kind: 'toggle', setting: 'showGrid' },
    cr: { kind: 'toggle', setting: 'cropView' },
    sc: { kind: 'toggle', setting: 'showCrop' },

    // Temporary hide and isolate
    hh: { kind: 'command', command: 'hideElement' },
    hi: { kind: 'command', command: 'isolateElement' },
    hr: { kind: 'command', command: 'resetHideIsolate' },
    rh: { kind: 'toggle', setting: 'revealHidden' },

    // Manage
    pi: { kind: 'command', command: 'projectInfo' },
    ex: { kind: 'command', command: 'export' },
    re: { kind: 'command', command: 'render' },
    dw: { kind: 'command', command: 'downloadDrawing' },
};

/**
 * The contextual tab Revit opens when something is selected, titled
 * `Modify | <Category>` and carrying the commands that act on it.
 */
export function contextualTab(category: string): RibbonTab {
    return {
        id: 'modify-contextual',
        title: `Modify | ${category}`,
        contextual: true,
        panels: [
            {
                id: 'contextual-select',
                title: 'Select',
                buttons: [
                    {
                        id: 'contextual-modify',
                        label: 'Modify',
                        icon: MousePointer2,
                        action: { kind: 'tool', tool: 'select' },
                        size: 'large',
                        shortcut: 'MD',
                    },
                ],
            },
            {
                id: 'contextual-geometry',
                title: 'Modify',
                buttons: [
                    {
                        id: 'contextual-move',
                        label: 'Move',
                        icon: Move,
                        action: { kind: 'tool', tool: 'move' },
                        size: 'large',
                        shortcut: 'MV',
                    },
                    {
                        id: 'contextual-copy',
                        label: 'Copy',
                        icon: Copy,
                        action: { kind: 'tool', tool: 'copy' },
                        size: 'large',
                        shortcut: 'CO',
                    },
                    {
                        id: 'contextual-rotate',
                        label: 'Rotate',
                        icon: RotateCw,
                        action: { kind: 'tool', tool: 'rotate' },
                        size: 'large',
                        shortcut: 'RO',
                    },
                    {
                        id: 'contextual-mirror',
                        label: 'Mirror',
                        icon: FlipHorizontal2,
                        action: { kind: 'tool', tool: 'mirror' },
                        size: 'large',
                        shortcut: 'MM',
                    },
                    {
                        id: 'contextual-delete',
                        label: 'Delete',
                        icon: Trash2,
                        action: { kind: 'command', command: 'delete' },
                        size: 'large',
                        shortcut: 'DE',
                    },
                ],
            },
            {
                id: 'contextual-view',
                title: 'View',
                buttons: [
                    {
                        id: 'contextual-hide',
                        label: 'Hide',
                        icon: EyeOff,
                        action: { kind: 'command', command: 'hideElement' },
                        size: 'large',
                        shortcut: 'HH',
                        hint: 'Hide the selection in this view only',
                    },
                    {
                        id: 'contextual-isolate',
                        label: 'Isolate',
                        icon: Focus,
                        action: { kind: 'command', command: 'isolateElement' },
                        size: 'small',
                        shortcut: 'HI',
                    },
                    {
                        id: 'contextual-reset-hide',
                        label: 'Reset',
                        icon: Eye,
                        action: {
                            kind: 'command',
                            command: 'resetHideIsolate',
                        },
                        size: 'small',
                        shortcut: 'HR',
                    },
                ],
            },
            {
                id: 'contextual-selection',
                title: 'Selection',
                buttons: [
                    {
                        id: 'contextual-select-all',
                        label: 'Select All Instances',
                        icon: BoxSelect,
                        action: { kind: 'command', command: 'selectAll' },
                        size: 'large',
                        shortcut: 'SA',
                    },
                ],
            },
            {
                id: 'contextual-measure',
                title: 'Measure',
                buttons: [
                    {
                        id: 'contextual-measure-tool',
                        label: 'Measure',
                        icon: Ruler,
                        action: { kind: 'tool', tool: 'measure' },
                        size: 'large',
                        shortcut: 'MS',
                    },
                ],
            },
        ],
    };
}
