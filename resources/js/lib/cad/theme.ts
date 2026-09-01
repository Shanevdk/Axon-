/**
 * Canvas colours.
 *
 * The 2D views are drawn as ink on warm paper and the 3D views are lit with a
 * sand key light, so the drawing area sits inside the Vanhaven palette rather
 * than the default CAD grey.
 */
export const CAD_THEME = {
    paper: '#f7f5f2',
    paperShade: '#efece7',
    grid: '#e2dcd3',
    gridMajor: '#d3cabd',
    ink: '#242424',
    inkSoft: '#5b5550',
    inkFaint: '#9a9186',
    sand: '#c2ab92',
    sandPale: '#e9e0d5',
    ember: '#f68b21',
    selection: '#0f7fbe',
    selectionFill: 'rgba(15, 127, 190, 0.16)',
    highlight: '#f68b21',
    highlightFill: 'rgba(246, 139, 33, 0.16)',
    wallExterior: '#3a3733',
    wallInterior: '#6c655d',
    wallFill: '#cdc4b8',
    wallFillInterior: '#ddd5ca',
    /** Solid poche used for walls at Coarse detail. */
    wallPoche: '#8c8378',
    wallHatch: 'rgba(36, 36, 36, 0.16)',
    sill: '#6c655d',
    /** Reference planes, in Revit's datum green. */
    referencePlane: '#3f7d4e',
    /** Revision clouds and their tags. */
    revision: '#a03d2d',
    /** Datum graphics: elevation markers, level heads, crop boundary. */
    datum: '#2a6f8f',
    cropRegion: '#9a9186',
    /** Blue of Revit's temporary dimensions and drag grips. */
    temporary: '#0f7fbe',
    grip: '#0f7fbe',
    gripFill: '#ffffff',
    glass: '#8fb6c4',
    roomFill: 'rgba(194, 171, 146, 0.22)',
    roomStroke: 'rgba(194, 171, 146, 0.85)',
    dimension: '#2a6f8f',
    text: '#242424',
    snap: '#0f7fbe',
    /** MEP system colours, muted to sit inside the ink-on-paper palette. */
    ductSupply: '#2a6f8f',
    ductReturn: '#a03d2d',
    ductExhaust: '#6c655d',
    pipeDomestic: '#2a6f8f',
    pipeSanitary: '#7a5a41',
    pipeHydronic: '#3f7d4e',
    pipeFire: '#b3362a',
    cableTray: '#a08252',
    /** Site graphics: topography fill and the legal boundary. */
    topo: '#7d8b66',
    topoFill: 'rgba(125, 139, 102, 0.14)',
    propertyLine: '#7c4a66',
    background3d: '#1f1e1d',
    background3dTop: '#33302c',
    ground: '#2a2825',
} as const;

export const MODEL_MATERIALS = {
    wallExterior: '#d9cec0',
    wallInterior: '#e6ded3',
    floor: '#b9ada0',
    roofSlab: '#a89b8c',
    column: '#8d8375',
    doorLeaf: '#8a6b4c',
    glass: '#9dc4d4',
    frame: '#4a453f',
    /** Imported STL and OBJ geometry, tinted so it reads as not-yet-modelled. */
    mesh: '#c2ab92',
    railing: '#5a544d',
    foundation: '#a8a29a',
    duct: '#9fa8ad',
    pipe: '#96705b',
    cableTray: '#7f858b',
    fixture: '#b3a48f',
    planting: '#7d8b66',
    site: '#8f8973',
} as const;

/** Direction of the key light used for flat shading in the 3D views. */
export const LIGHT_DIRECTION = { x: -0.42, y: -0.58, z: 0.7 };

export const AMBIENT_LIGHT = 0.42;

/**
 * What the materials actually look like.
 *
 * `MODEL_MATERIALS` above is the drawing palette — everything tinted into the
 * studio's own colours so a model reads as a drawing. This is the other view:
 * timber the colour of timber, concrete the colour of concrete. Switched by
 * the `naturalMaterials` view setting.
 */
export const NATURAL_MATERIALS: Record<string, string> = {
    /** Softwood framing, planed and new. */
    wood: '#c08e4e',
    /** OSB, which is chip and glue and reads yellower than sawn timber. */
    sheathing: '#c9a06a',
    /** Paper-faced board, off-white. */
    gypsum: '#efeae1',
    /** Fibreglass batt, the pink everyone knows. */
    insulation: '#e0a89c',
    concrete: '#a9a8a4',
    /** Clay brick. */
    masonry: '#9c5a45',
    steel: '#7d848a',
    /** Galvanised duct and tray. */
    metal: '#a8afb4',
    glass: '#a6c8d8',
    /** Asphalt shingle. */
    shingle: '#4b4845',
    earth: '#7a6a52',
    foliage: '#6f8b5c',
    generic: '#b3a48f',
};

/**
 * How a material's surface is marked up close: timber gets its grain, brick
 * and block get their courses, and everything else is drawn flat because it
 * is flat.
 */
export const MATERIAL_GRAIN: Record<string, 'wood' | 'masonry' | null> = {
    wood: 'wood',
    sheathing: 'wood',
    masonry: 'masonry',
    gypsum: null,
    insulation: null,
    concrete: null,
    steel: null,
    metal: null,
    glass: null,
    shingle: null,
    earth: null,
    foliage: null,
    generic: null,
};
