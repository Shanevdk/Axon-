import type {
    CadDocument,
    CadView,
    Level,
    Orientation,
    ViewSettings,
} from '@/lib/cad/types';

export const DEFAULT_VIEW_SETTINGS: ViewSettings = {
    scale: 100,
    detailLevel: 'medium',
    visualStyle: 'hiddenLine',
    showGrid: true,
    showRooms: true,
    showTags: true,
    underlay: false,
    cropView: false,
    showCrop: false,
    shadows: false,
    crop: null,
    phaseFilter: 'all',
    hiddenCategories: [],
};

export const VIEW_SCALES = [10, 20, 25, 50, 100, 200, 500, 1000];

const ORIENTATIONS: Orientation[] = ['north', 'south', 'east', 'west'];

/**
 * Views are derived from the levels rather than stored, so adding a level
 * always produces its plans. Only the per-view overrides are persisted.
 */
export function deriveViews(document: CadDocument): CadView[] {
    const plans = document.levels.map<CadView>((level) => ({
        id: `plan:${level.id}`,
        name: level.name,
        kind: 'plan',
        level: level.id,
    }));

    const ceilings = document.levels.map<CadView>((level) => ({
        id: `rcp:${level.id}`,
        name: level.name,
        kind: 'ceiling',
        level: level.id,
    }));

    const elevations = ORIENTATIONS.map<CadView>((orientation) => ({
        id: `elevation:${orientation}`,
        name: `${orientation[0].toUpperCase()}${orientation.slice(1)}`,
        kind: 'elevation',
        orientation,
        level: document.levels[0]?.id,
    }));

    const sections = document.elements
        .filter((element) => element.kind === 'section')
        .map<CadView>((element, index) => ({
            id: `section:${element.id}`,
            name:
                'name' in element && element.name
                    ? element.name
                    : `Section ${index + 1}`,
            kind: 'section',
            level: element.level,
            sectionId: element.id,
        }));

    const schedules: CadView[] = [
        {
            id: 'schedule:room',
            name: 'Room Schedule',
            kind: 'schedule',
            schedule: 'room',
        },
        {
            id: 'schedule:door',
            name: 'Door Schedule',
            kind: 'schedule',
            schedule: 'door',
        },
        {
            id: 'schedule:window',
            name: 'Window Schedule',
            kind: 'schedule',
            schedule: 'window',
        },
        {
            id: 'schedule:wall',
            name: 'Wall Schedule',
            kind: 'schedule',
            schedule: 'wall',
        },
    ];

    return [
        ...plans,
        ...ceilings,
        ...elevations,
        ...sections,
        {
            id: 'threeD:default',
            name: '{3D}',
            kind: 'threeD',
            level: document.levels[0]?.id,
        },
        ...schedules,
    ];
}

export function defaultViewId(document: CadDocument): string {
    return `plan:${document.levels[0]?.id ?? 'level-1'}`;
}

export function findView(views: CadView[], id: string): CadView {
    return views.find((view) => view.id === id) ?? views[0];
}

export function settingsFor(
    document: CadDocument,
    viewId: string,
): ViewSettings {
    return {
        ...DEFAULT_VIEW_SETTINGS,
        ...(document.viewSettings?.[viewId] ?? {}),
    };
}

export function levelFor(document: CadDocument, view: CadView): Level {
    return (
        document.levels.find((level) => level.id === view.level) ??
        document.levels[0] ?? { id: 'level-1', name: 'Level 1', elevation: 0 }
    );
}

export function isDrawingView(view: CadView): boolean {
    return view.kind === 'plan' || view.kind === 'ceiling';
}

export function isModelView(view: CadView): boolean {
    return (
        view.kind === 'threeD' ||
        view.kind === 'elevation' ||
        view.kind === 'section'
    );
}

/**
 * Group views the way the Project Browser does.
 */
export function browserGroups(
    views: CadView[],
): { title: string; views: CadView[] }[] {
    return [
        {
            title: 'Floor Plans',
            views: views.filter((view) => view.kind === 'plan'),
        },
        {
            title: 'Ceiling Plans',
            views: views.filter((view) => view.kind === 'ceiling'),
        },
        {
            title: '3D Views',
            views: views.filter((view) => view.kind === 'threeD'),
        },
        {
            title: 'Elevations',
            views: views.filter((view) => view.kind === 'elevation'),
        },
        {
            title: 'Sections',
            views: views.filter((view) => view.kind === 'section'),
        },
        {
            title: 'Schedules/Quantities',
            views: views.filter((view) => view.kind === 'schedule'),
        },
    ].filter((group) => group.views.length > 0);
}

/**
 * Camera azimuth, in radians, that looks at a building from a given side.
 */
export function azimuthFor(orientation: Orientation): number {
    const azimuths: Record<Orientation, number> = {
        north: -Math.PI / 2,
        south: Math.PI / 2,
        east: Math.PI,
        west: 0,
    };

    return azimuths[orientation];
}
