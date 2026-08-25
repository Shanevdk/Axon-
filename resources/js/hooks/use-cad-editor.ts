import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCadDocument } from '@/hooks/use-cad-document';
import { extractTypeLibrary } from '@/lib/cad/exchange/insert';
import { boundsOf, boundsCenter, expandBounds } from '@/lib/cad/geometry';
import type { Bounds } from '@/lib/cad/geometry';
import { buildModelFaces, groundFace } from '@/lib/cad/mesh';
import {
    buildWallGeometry,
    createId,
    wallsOnLevel,
    withoutElements,
} from '@/lib/cad/model';
import type { WallGeometry } from '@/lib/cad/model';
import { fitCamera } from '@/lib/cad/render-3d';
import type { CommandId, ToggleId } from '@/lib/cad/ribbon';
import { computeRoomBoundaries } from '@/lib/cad/rooms';
import type { RoomBoundary } from '@/lib/cad/rooms';
import { DEFAULT_SNAP_SETTINGS } from '@/lib/cad/snapping';
import type { SnapSettings } from '@/lib/cad/snapping';
import type {
    CadDocument,
    CadView,
    Camera,
    DrawMode,
    Level,
    LocationLine,
    OrbitCamera,
    Point,
    RoomElement,
    ToolId,
    ViewSettings,
} from '@/lib/cad/types';
import {
    azimuthFor,
    browserGroups,
    defaultViewId,
    deriveViews,
    findView,
    isDrawingView,
    levelFor,
    settingsFor,
} from '@/lib/cad/views';

const AUTOSAVE_DELAY = 1200;

const DEFAULT_ORBIT: OrbitCamera = {
    azimuth: -Math.PI / 4,
    elevation: Math.PI / 5,
    distance: 32_000,
    target: { x: 6000, y: 4500, z: 1500 },
};

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export type CadEditor = ReturnType<typeof useCadEditor>;

export function useCadEditor(initialDocument: CadDocument, saveUrl: string) {
    const store = useCadDocument(initialDocument);
    const { document } = store;

    const [tool, setToolState] = useState<ToolId>('select');
    const [drawMode, setDrawMode] = useState<DrawMode>('line');
    const [activeViewId, setActiveViewId] = useState(() =>
        defaultViewId(initialDocument),
    );
    const [selection, setSelection] = useState<string[]>([]);
    const [hovered, setHovered] = useState<string | null>(null);
    const [wallTypeId, setWallTypeId] = useState(
        () => initialDocument.wallTypes[0]?.id ?? '',
    );
    const [doorTypeId, setDoorTypeId] = useState(
        () => initialDocument.doorTypes[0]?.id ?? '',
    );
    const [windowTypeId, setWindowTypeId] = useState(
        () => initialDocument.windowTypes[0]?.id ?? '',
    );
    const [wallHeight, setWallHeight] = useState(3000);
    const [roofSlope, setRoofSlope] = useState(30);
    const [roofOverhang, setRoofOverhang] = useState(450);
    const [stairWidth, setStairWidth] = useState(1000);
    const [beamSize, setBeamSize] = useState({ width: 300, depth: 500 });
    const [offsetDistance, setOffsetDistance] = useState(600);
    const [arrayCount, setArrayCount] = useState(4);
    const [locationLine, setLocationLine] = useState<LocationLine>('center');
    const [ortho, setOrtho] = useState(false);
    const [snapsEnabled, setSnapsEnabled] = useState(true);
    const [snaps, setSnaps] = useState<SnapSettings>(DEFAULT_SNAP_SETTINGS);
    const [cameras, setCameras] = useState<Record<string, Camera>>({});
    const [orbit, setOrbit] = useState<OrbitCamera>(DEFAULT_ORBIT);
    const [viewport, setViewportState] = useState({ width: 1200, height: 800 });
    const [status, setStatus] = useState('Ready');
    const [saveState, setSaveState] = useState<SaveState>('idle');
    const [savedAt, setSavedAt] = useState<string | null>(null);
    const [projectInfoOpen, setProjectInfoOpen] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [exportOpen, setExportOpen] = useState(false);
    const [renderOpen, setRenderOpen] = useState(false);
    const [hidden, setHidden] = useState<Set<string>>(() => new Set());
    const [revealHidden, setRevealHidden] = useState(false);

    const exportRequest = useRef(0);
    const [exportToken, setExportToken] = useState(0);

    const views = useMemo(() => deriveViews(document), [document]);
    const activeView: CadView = useMemo(
        () => findView(views, activeViewId),
        [views, activeViewId],
    );
    const level: Level = useMemo(
        () => levelFor(document, activeView),
        [document, activeView],
    );
    const settings: ViewSettings = useMemo(
        () => settingsFor(document, activeView.id),
        [document, activeView.id],
    );
    const groups = useMemo(() => browserGroups(views), [views]);

    const geometry: Map<string, WallGeometry> = useMemo(
        () => buildWallGeometry(document, wallsOnLevel(document, level.id)),
        [document, level.id],
    );

    const rooms: Map<string, RoomBoundary> = useMemo(() => {
        const tags = document.elements.filter(
            (element): element is RoomElement =>
                element.kind === 'room' && element.level === level.id,
        );

        return computeRoomBoundaries(tags, [...geometry.values()]);
    }, [document, level.id, geometry]);

    const underlay: WallGeometry[] = useMemo(() => {
        const index = document.levels.findIndex((item) => item.id === level.id);
        const below = document.levels[index - 1];

        if (!settings.underlay || !below) {
            return [];
        }

        return [
            ...buildWallGeometry(
                document,
                wallsOnLevel(document, below.id),
            ).values(),
        ];
    }, [document, level.id, settings.underlay]);

    const faces = useMemo(
        () => [groundFace(document), ...buildModelFaces(document)],
        [document],
    );

    /**
     * Stable setter that ignores no-op resizes, otherwise the ResizeObserver
     * that feeds it would re-render on every frame.
     */
    const setViewport = useCallback(
        (next: { width: number; height: number }) => {
            setViewportState((previous) =>
                previous.width === next.width && previous.height === next.height
                    ? previous
                    : next,
            );
        },
        [],
    );

    const camera: Camera = cameras[activeView.id] ?? {
        zoom: 0.03,
        center: { x: 6000, y: 4500 },
    };

    const setCamera = useCallback(
        (next: Camera | ((previous: Camera) => Camera)) => {
            setCameras((previous) => {
                const current = previous[activeViewId] ?? {
                    zoom: 0.03,
                    center: { x: 6000, y: 4500 },
                };

                return {
                    ...previous,
                    [activeViewId]:
                        typeof next === 'function' ? next(current) : next,
                };
            });
        },
        [activeViewId],
    );

    const setViewSetting = useCallback(
        <K extends keyof ViewSettings>(key: K, value: ViewSettings[K]) => {
            store.commit(`Change ${String(key)}`, (current) => ({
                ...current,
                viewSettings: {
                    ...current.viewSettings,
                    [activeViewId]: {
                        ...(current.viewSettings?.[activeViewId] ?? {}),
                        [key]: value,
                    },
                },
            }));
        },
        [store, activeViewId],
    );

    /** Bounding box of everything drawn on the active level. */
    const levelBounds = useCallback((): Bounds | null => {
        const points: Point[] = [];

        geometry.forEach((wall) => points.push(...wall.polygon));
        document.elements.forEach((element) => {
            if (element.level !== level.id) {
                return;
            }

            if (element.kind === 'floor') {
                points.push(...element.points);
            }

            if (
                element.kind === 'column' ||
                element.kind === 'room' ||
                element.kind === 'text'
            ) {
                points.push(element.p);
            }

            if (
                element.kind === 'dimension' ||
                element.kind === 'line' ||
                element.kind === 'stair' ||
                element.kind === 'grid' ||
                element.kind === 'beam'
            ) {
                points.push(element.a, element.b);
            }

            if (element.kind === 'roof' || element.kind === 'ceiling') {
                points.push(...element.points);
            }
        });

        return boundsOf(points);
    }, [document, geometry, level.id]);

    const zoomFit = useCallback(() => {
        if (activeView.kind === 'threeD' || activeView.kind === 'elevation') {
            setOrbit((previous) => fitCamera(faces, previous));

            return;
        }

        const bounds = levelBounds();

        if (!bounds) {
            setCamera({ zoom: 0.03, center: { x: 0, y: 0 } });

            return;
        }

        const padded = expandBounds(bounds, 1500);
        const zoom = Math.min(
            viewport.width / Math.max(padded.maxX - padded.minX, 1),
            viewport.height / Math.max(padded.maxY - padded.minY, 1),
        );

        setCamera({ zoom: zoom * 0.92, center: boundsCenter(padded) });
    }, [activeView.kind, faces, levelBounds, setCamera, viewport]);

    const setTool = useCallback((next: ToolId) => {
        setToolState(next);
        setStatus(
            next === 'select'
                ? 'Ready'
                : `${next[0].toUpperCase()}${next.slice(1)} tool`,
        );
    }, []);

    const clearSelection = useCallback(() => setSelection([]), []);

    /** Take the selection out of the view, as Hide Elements does. */
    const hideSelection = useCallback(() => {
        if (selection.length === 0) {
            return;
        }

        setHidden((previous) => new Set([...previous, ...selection]));
        setSelection([]);
        setStatus('Elements hidden in view');
    }, [selection]);

    /** Hide everything on the level except the selection. */
    const isolateSelection = useCallback(() => {
        if (selection.length === 0) {
            return;
        }

        const kept = new Set(selection);

        setHidden(
            new Set(
                document.elements
                    .filter(
                        (element) =>
                            element.level === level.id && !kept.has(element.id),
                    )
                    .map((element) => element.id),
            ),
        );
        setStatus('Isolated selection');
    }, [document.elements, level.id, selection]);

    const resetTemporaryHide = useCallback(() => {
        setHidden(new Set());
        setRevealHidden(false);
        setStatus('Temporary hide reset');
    }, []);

    const deleteSelection = useCallback(() => {
        if (selection.length === 0) {
            return;
        }

        store.commit('Delete', (current) =>
            withoutElements(current, selection),
        );
        setSelection([]);
        setStatus('Deleted');
    }, [selection, store]);

    /** Capture the active view's settings as a named template. */
    const saveViewTemplate = useCallback(
        (name: string) => {
            const captured = settings;

            store.commit('Save view template', (current) => ({
                ...current,
                viewTemplates: [
                    ...(current.viewTemplates ?? []),
                    {
                        id: createId('template'),
                        name,
                        settings: captured,
                    },
                ],
            }));
            setStatus(`View template "${name}" saved`);
        },
        [settings, store],
    );

    /** Apply a template's settings onto the active view. */
    const applyViewTemplate = useCallback(
        (templateId: string) => {
            store.commit('Apply view template', (current) => {
                const template = (current.viewTemplates ?? []).find(
                    (item) => item.id === templateId,
                );

                if (!template) {
                    return current;
                }

                return {
                    ...current,
                    viewSettings: {
                        ...current.viewSettings,
                        [activeViewId]: {
                            ...(current.viewSettings?.[activeViewId] ?? {}),
                            ...template.settings,
                        },
                    },
                };
            });
            setStatus('View template applied');
        },
        [activeViewId, store],
    );

    const addLevel = useCallback(() => {
        store.commit('Add level', (current) => {
            const highest = current.levels.reduce(
                (top, item) => Math.max(top, item.elevation),
                0,
            );
            const id = createId('level');

            return {
                ...current,
                levels: [
                    ...current.levels,
                    {
                        id,
                        name: `Level ${current.levels.length + 1}`,
                        elevation: highest + 3000,
                    },
                ],
            };
        });
        setStatus('Level added');
    }, [store]);

    /**
     * Opening an elevation aims the camera at that side of the building, the
     * way Revit's elevation markers do.
     */
    const openView = useCallback(
        (id: string) => {
            setActiveViewId(id);
            setSelection([]);
            setHovered(null);

            const target = views.find((view) => view.id === id);

            if (target?.kind === 'elevation' && target.orientation) {
                const orientation = target.orientation;

                setOrbit((previous) => ({
                    ...fitCamera(faces, previous),
                    azimuth: azimuthFor(orientation),
                    elevation: 0.02,
                }));
            }

            if (target?.kind === 'section' && target.sectionId) {
                const mark = document.elements.find(
                    (element) => element.id === target.sectionId,
                );

                if (mark?.kind === 'section') {
                    // The view looks left of a→b; the camera sits opposite.
                    const angle = Math.atan2(
                        mark.b.y - mark.a.y,
                        mark.b.x - mark.a.x,
                    );

                    setOrbit((previous) => ({
                        ...fitCamera(faces, previous),
                        azimuth: angle + Math.PI / 2,
                        elevation: 0.02,
                    }));
                }
            }
        },
        [document.elements, faces, views],
    );

    const applyToggle = useCallback(
        (setting: ToggleId) => {
            if (setting === 'ortho') {
                setOrtho((previous) => !previous);

                return;
            }

            if (setting === 'snaps') {
                setSnapsEnabled((previous) => !previous);

                return;
            }

            if (setting === 'revealHidden') {
                setRevealHidden((previous) => !previous);

                return;
            }

            setViewSetting(setting, !settings[setting]);
        },
        [setViewSetting, settings],
    );

    const save = useCallback(async () => {
        setSaveState('saving');

        try {
            const response = await fetch(saveUrl, {
                method: 'PUT',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-XSRF-TOKEN': readXsrfToken(),
                },
                body: JSON.stringify({ document }),
            });

            if (!response.ok) {
                throw new Error(`Save failed with status ${response.status}`);
            }

            const payload = (await response.json()) as { saved_at?: string };

            store.markSaved(store.revision);
            setSavedAt(payload.saved_at ?? null);
            setSaveState('saved');
        } catch {
            setSaveState('error');
        }
    }, [document, saveUrl, store]);

    const runCommand = useCallback(
        (command: CommandId) => {
            switch (command) {
                case 'undo':
                    store.undo();
                    setSelection([]);
                    break;
                case 'redo':
                    store.redo();
                    setSelection([]);
                    break;
                case 'save':
                    void save();
                    break;
                case 'delete':
                    deleteSelection();
                    break;
                case 'zoomFit':
                    zoomFit();
                    break;
                case 'addLevel':
                    addLevel();
                    break;
                case 'projectInfo':
                    setProjectInfoOpen(true);
                    break;
                case 'import':
                    setImportOpen(true);
                    break;
                case 'exportModel':
                    setExportOpen(true);
                    break;
                case 'render':
                    setRenderOpen(true);
                    break;
                case 'exportTypes':
                    downloadTypeLibrary(document);
                    setStatus('Type library saved');
                    break;
                case 'openThreeD':
                    openView('threeD:default');
                    break;
                case 'openSchedule':
                    openView('schedule:room');
                    break;
                case 'export':
                    exportRequest.current += 1;
                    setExportToken(exportRequest.current);
                    break;
                case 'hideElement':
                    hideSelection();
                    break;
                case 'isolateElement':
                    isolateSelection();
                    break;
                case 'resetHideIsolate':
                    resetTemporaryHide();
                    break;
                case 'selectAll':
                    setSelection(
                        document.elements
                            .filter((element) => element.level === level.id)
                            .map((element) => element.id),
                    );
                    setStatus('Selected everything on this level');
                    break;
                case 'styleWireframe':
                    setViewSetting('visualStyle', 'wireframe');
                    break;
                case 'styleHiddenLine':
                    setViewSetting('visualStyle', 'hiddenLine');
                    break;
                case 'styleShaded':
                    setViewSetting('visualStyle', 'shaded');
                    break;
                case 'styleRealistic':
                    setViewSetting('visualStyle', 'realistic');
                    break;
            }
        },
        [
            addLevel,
            deleteSelection,
            document,
            hideSelection,
            isolateSelection,
            level.id,
            openView,
            resetTemporaryHide,
            save,
            setViewSetting,
            store,
            zoomFit,
        ],
    );

    // Autosave shortly after the model stops changing.
    useEffect(() => {
        if (!store.isDirty) {
            return;
        }

        const timer = window.setTimeout(() => {
            void save();
        }, AUTOSAVE_DELAY);

        return () => window.clearTimeout(timer);
    }, [store.isDirty, store.revision, save]);

    return {
        store,
        document,
        views,
        groups,
        activeView,
        activeViewId,
        level,
        settings,
        geometry,
        rooms,
        underlay,
        faces,
        camera,
        setCamera,
        orbit,
        setOrbit,
        viewport,
        setViewport,
        tool,
        setTool,
        drawMode,
        setDrawMode,
        selection,
        setSelection,
        clearSelection,
        hovered,
        setHovered,
        wallTypeId,
        setWallTypeId,
        doorTypeId,
        setDoorTypeId,
        windowTypeId,
        setWindowTypeId,
        wallHeight,
        setWallHeight,
        roofSlope,
        setRoofSlope,
        roofOverhang,
        setRoofOverhang,
        stairWidth,
        setStairWidth,
        beamSize,
        setBeamSize,
        offsetDistance,
        setOffsetDistance,
        arrayCount,
        setArrayCount,
        locationLine,
        setLocationLine,
        ortho,
        setOrtho,
        snaps,
        setSnaps,
        snapsEnabled,
        setSnapsEnabled,
        status,
        setStatus,
        saveState,
        savedAt,
        projectInfoOpen,
        setProjectInfoOpen,
        importOpen,
        setImportOpen,
        exportOpen,
        setExportOpen,
        renderOpen,
        setRenderOpen,
        hidden,
        revealHidden,
        setRevealHidden,
        hideSelection,
        isolateSelection,
        resetTemporaryHide,
        exportToken,
        isDrawing: isDrawingView(activeView),
        openView,
        saveViewTemplate,
        applyViewTemplate,
        setViewSetting,
        applyToggle,
        runCommand,
        deleteSelection,
        zoomFit,
        save,
    };
}

function readXsrfToken(): string {
    const match = window.document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/);

    return match ? decodeURIComponent(match[1]) : '';
}

/** Save the project's wall, door and window types as a reusable library file. */
function downloadTypeLibrary(document: CadDocument): void {
    const blob = new Blob(
        [JSON.stringify(extractTypeLibrary(document), null, 2)],
        {
            type: 'application/json',
        },
    );
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');

    link.href = url;
    link.download = 'axon-types.json';
    link.click();

    URL.revokeObjectURL(url);
}
