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
    naturalMaterials: false,
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
        {
            id: 'schedule:materials',
            name: 'Bill of Materials',
            kind: 'schedule',
            schedule: 'materials',
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
        // One property, so one site plan. It is always offered, because the
        // view is where the ground is measured in the first place.
        {
            id: 'site:default',
            name: 'Site',
            kind: 'site',
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

/**
 * How a view looks before anyone has changed it.
 *
 * Hidden line is right for everything drawn on a sheet: a plan, a ceiling, an
 * elevation, a section. It is white paper and black ink because that is what
 * it will be printed as.
 *
 * A 3D view is not a sheet. Opening the model in hidden line shows a white
 * building on white ground, which reads as a broken screen rather than as a
 * drawing convention, so it opens shaded and in its own materials. The site
 * view is the ground itself, and is no use without them either.
 */
export function defaultSettingsFor(kind: CadView['kind']): ViewSettings {
    if (kind !== 'threeD' && kind !== 'site') {
        return DEFAULT_VIEW_SETTINGS;
    }

    return {
        ...DEFAULT_VIEW_SETTINGS,
        visualStyle: 'shaded',
        naturalMaterials: true,
    };
}

export function settingsFor(
    document: CadDocument,
    view: CadView,
): ViewSettings {
    return {
        ...defaultSettingsFor(view.kind),
        ...(document.viewSettings?.[view.id] ?? {}),
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
            title: 'Site',
            views: views.filter((view) => view.kind === 'site'),
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

/**
 * The settings that follow from switching natural materials on or off.
 *
 * Materials are a colour, and two of the visual styles do not show colour:
 * hidden line paints every face white and wireframe paints none of them. So
 * switching materials on in either of those would change a setting and
 * nothing visible, which is worse than the control not being there — the
 * view is brought to a shaded one at the same time.
 *
 * Switching them off leaves the style alone: having asked for shading once,
 * you probably still want it.
 */
export function withNaturalMaterials(
    settings: ViewSettings,
    on: boolean,
): Partial<ViewSettings> {
    const blind =
        settings.visualStyle === 'hiddenLine' ||
        settings.visualStyle === 'wireframe';

    return on && blind
        ? { naturalMaterials: true, visualStyle: 'shaded' }
        : { naturalMaterials: on };
}
