/**
 * Canvas colours.
 *
 * The 2D views are drawn as ink on warm paper and the 3D views are lit with a
 * sand key light, so the drawing area sits inside the Axon palette rather
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
} as const;

/** Direction of the key light used for flat shading in the 3D views. */
export const LIGHT_DIRECTION = { x: -0.42, y: -0.58, z: 0.7 };

export const AMBIENT_LIGHT = 0.42;
