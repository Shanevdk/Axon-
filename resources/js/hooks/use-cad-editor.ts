import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCadDocument } from '@/hooks/use-cad-document';
import { purgeUnusedTypes } from '@/lib/cad/checkup';
import { cleanUpDocument } from '@/lib/cad/cleanup';
import { bringWallsUpToCode, requirementFor } from '@/lib/cad/code';
import { extractTypeLibrary } from '@/lib/cad/exchange/insert';
import { focusedAssembly } from '@/lib/cad/explode';
import { boundsOf, boundsCenter, expandBounds } from '@/lib/cad/geometry';
import type { Bounds } from '@/lib/cad/geometry';
import { buildModelFaces, groundFaces } from '@/lib/cad/mesh';
import {
    buildWallGeometry,
    createId,
    toolForKind,
    wallsOnLevel,
    withMatchedTypes,
    withoutElements,
    withPinned,
} from '@/lib/cad/model';
import type { WallGeometry } from '@/lib/cad/model';
import { buildClientModel, buildPreview, summarise } from '@/lib/cad/preview';
import { fitCamera } from '@/lib/cad/render-3d';
import type { CommandId, ToggleId } from '@/lib/cad/ribbon';
import { computeRoomBoundaries } from '@/lib/cad/rooms';
import type { RoomBoundary } from '@/lib/cad/rooms';
import { DEFAULT_SNAP_SETTINGS } from '@/lib/cad/snapping';
import type { SnapSettings } from '@/lib/cad/snapping';
import { terrainBounds } from '@/lib/cad/terrain';
import type {
    CadDocument,
    CadView,
    Camera,
    DrawMode,
    DuctSystem,
    FixtureCategory,
    Level,
    LocationLine,
    OrbitCamera,
    PipeSystem,
    Point,
    RoomElement,
    ToolId,
    ViewSettings,
    WalkCamera,
} from '@/lib/cad/types';
import type { DrawingVault } from '@/lib/cad/vault';
import {
    azimuthFor,
    browserGroups,
    defaultViewId,
    deriveViews,
    findView,
    isDrawingView,
    levelFor,
    settingsFor,
    withNaturalMaterials,
} from '@/lib/cad/views';

/**
 * The drawing is written to this computer almost as fast as it changes — this
 * is the save that matters, so it is deliberately close to instant.
 */
const LOCAL_SAVE_DELAY = 250;

/**
 * The server only receives a one-level preview for the projects page, so it
 * can wait for a lull.
 */
const PUBLISH_DELAY = 1500;

const DEFAULT_ORBIT: OrbitCamera = {
    azimuth: -Math.PI / 4,
    elevation: Math.PI / 5,
    distance: 32_000,
    target: { x: 6000, y: 4500, z: 1500 },
};

/** Standing eye height for first-person mode, in millimetres. */
export const EYE_HEIGHT = 1600;

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export type CadEditor = ReturnType<typeof useCadEditor>;

export type EditorStorage = {
    /** Which project this is, and therefore which vault slot it owns. */
    projectId: number;
    /** Where the model is held on this computer. */
    vault: DrawingVault;
    /** False when IndexedDB is unavailable and the vault forgets on close. */
    persistent: boolean;
};

export function useCadEditor(
    initialDocument: CadDocument,
    saveUrl: string,
    storage: EditorStorage,
    /**
     * Where the building is, as the project records it. The energy code the
     * walls answer to depends on it, so it travels with the editor rather
     * than only with the code consultant.
     */
    jurisdiction: string | null = null,
) {
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
    const [ductWidth, setDuctWidth] = useState(400);
    const [ductSystem, setDuctSystem] = useState<DuctSystem>('supply');
    const [pipeDiameter, setPipeDiameter] = useState(100);
    const [pipeSystem, setPipeSystem] = useState<PipeSystem>('domestic');
    const [trayWidth, setTrayWidth] = useState(300);
    const [mepElevation, setMepElevation] = useState(2700);
    const [fixtureCategory, setFixtureCategory] =
        useState<FixtureCategory>('furniture');
    const [offsetDistance, setOffsetDistance] = useState(600);
    const [arrayCount, setArrayCount] = useState(4);
    const [locationLine, setLocationLine] = useState<LocationLine>('center');
    const [ortho, setOrtho] = useState(false);
    const [snapsEnabled, setSnapsEnabled] = useState(true);
    const [snaps, setSnaps] = useState<SnapSettings>(DEFAULT_SNAP_SETTINGS);
    const [cameras, setCameras] = useState<Record<string, Camera>>({});
    const [orbit, setOrbit] = useState<OrbitCamera>(DEFAULT_ORBIT);
    const [walkMode, setWalkMode] = useState(false);
    const [walk, setWalk] = useState<WalkCamera>({
        eye: { x: 6000, y: 4500, z: EYE_HEIGHT },
        yaw: Math.PI / 2,
        pitch: 0,
    });
    const [tourPlaying, setTourPlaying] = useState(false);
    const [explodeFactor, setExplodeFactor] = useState(0);
    const [viewport, setViewportState] = useState({ width: 1200, height: 800 });
    const [status, setStatus] = useState('Ready');
    const [saveState, setSaveState] = useState<SaveState>('idle');
    const [savedAt, setSavedAt] = useState<string | null>(null);
    const [projectInfoOpen, setProjectInfoOpen] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [exportOpen, setExportOpen] = useState(false);
    const [renderOpen, setRenderOpen] = useState(false);
    const [codeAssistantOpen, setCodeAssistantOpen] = useState(false);
    const [warningsOpen, setWarningsOpen] = useState(false);
    const [libraryOpen, setLibraryOpen] = useState(false);
    const [groundOpen, setGroundOpen] = useState(false);
    const [hidden, setHidden] = useState<Set<string>>(() => new Set());
    const [revealHidden, setRevealHidden] = useState(false);

    const { projectId, vault, persistent } = storage;

    // The last revision the server was told about, so a lull does not send
    // the same preview twice.
    const publishedRevision = useRef(0);

    const exportRequest = useRef(0);
    const [exportToken, setExportToken] = useState(0);

    /** What the walls must achieve where this building is, or null. */
    const codeRequirement = useMemo(
        () => requirementFor(jurisdiction),
        [jurisdiction],
    );

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
        () => settingsFor(document, activeView),
        [document, activeView],
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

    /**
     * The one element being taken apart, which is simply whatever is selected
     * on its own. Selecting nothing explodes the whole building instead.
     */
    const explodeFocus = selection.length === 1 ? selection[0] : null;

    const faces = useMemo(
        () => [
            ...groundFaces(document),
            ...buildModelFaces(document, {
                factor: explodeFactor,
                focus: explodeFocus,
            }),
        ],
        [document, explodeFactor, explodeFocus],
    );

    /** The layers on show while one element is exploded, for the legend. */
    const explodedParts = useMemo(
        () =>
            explodeFactor > 0 ? focusedAssembly(document, explodeFocus) : null,
        [document, explodeFactor, explodeFocus],
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

    /**
     * Change several view settings together, as one entry in the history.
     */
    const setViewSettings = useCallback(
        (values: Partial<ViewSettings>, label = 'Change view') => {
            store.commit(label, (current) => ({
                ...current,
                viewSettings: {
                    ...current.viewSettings,
                    [activeViewId]: {
                        ...(current.viewSettings?.[activeViewId] ?? {}),
                        ...values,
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
                element.kind === 'text' ||
                element.kind === 'footing' ||
                element.kind === 'fixture' ||
                element.kind === 'spotElevation'
            ) {
                points.push(element.p);
            }

            if (
                element.kind === 'dimension' ||
                element.kind === 'line' ||
                element.kind === 'stair' ||
                element.kind === 'grid' ||
                element.kind === 'beam' ||
                element.kind === 'railing' ||
                element.kind === 'brace' ||
                element.kind === 'duct' ||
                element.kind === 'pipe' ||
                element.kind === 'cableTray'
            ) {
                points.push(element.a, element.b);
            }

            if (
                element.kind === 'roof' ||
                element.kind === 'ceiling' ||
                element.kind === 'pad' ||
                element.kind === 'toposurface' ||
                element.kind === 'propertyLine'
            ) {
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

        // On the site plan the subject is the property, not the house. Fitting
        // to the building would fill the screen with a footprint and push the
        // ground it is being sited on off the edges.
        const bounds =
            activeView.kind === 'site' && document.site?.terrain
                ? terrainBounds(document.site.terrain)
                : levelBounds();

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
    }, [
        activeView.kind,
        document.site,
        faces,
        levelBounds,
        setCamera,
        viewport,
    ]);

    const setTool = useCallback((next: ToolId) => {
        setToolState(next);
        setStatus(
            next === 'select'
                ? 'Ready'
                : `${next[0].toUpperCase()}${next.slice(1)} tool`,
        );
    }, []);

    /**
     * Drop to eye height in the middle of the level, looking the way the
     * orbit camera was already looking, and start walking.
     */
    const enterWalkMode = useCallback(() => {
        const bounds = levelBounds();
        const centre = bounds
            ? boundsCenter(bounds)
            : { x: orbit.target.x, y: orbit.target.y };

        setWalk({
            eye: { x: centre.x, y: centre.y, z: level.elevation + EYE_HEIGHT },
            yaw: orbit.azimuth + Math.PI,
            pitch: 0,
        });
        setWalkMode(true);
        setStatus(
            'First person — WASD to walk, drag to look, Q/E for height, Shift to run, Esc to exit',
        );
    }, [level.elevation, levelBounds, orbit.azimuth, orbit.target]);

    const exitWalkMode = useCallback(() => {
        setWalkMode(false);
        setTourPlaying(false);
        setStatus('Ready');
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

        // Pinned elements sit out a delete the same way they sit out a move.
        const pinned = new Set(
            document.elements
                .filter((element) => element.pinned)
                .map((element) => element.id),
        );
        const doomed = selection.filter((id) => !pinned.has(id));

        if (doomed.length === 0) {
            setStatus('Everything selected is pinned — unpin it first (UP)');

            return;
        }

        store.commit('Delete', (current) => withoutElements(current, doomed));
        setSelection([]);
        setStatus(
            doomed.length === selection.length
                ? 'Deleted'
                : `Deleted ${doomed.length} — ${selection.length - doomed.length} pinned kept`,
        );
    }, [document.elements, selection, store]);

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

            if (setting === 'naturalMaterials') {
                const on = !settings.naturalMaterials;
                const next = withNaturalMaterials(settings, on);

                setViewSettings(next, on ? 'Show materials' : 'Hide materials');

                setStatus(
                    on
                        ? next.visualStyle
                            ? 'Natural materials on — the view is now shaded so they show'
                            : 'Natural materials on'
                        : 'Natural materials off',
                );

                return;
            }

            if (setting === 'walkMode') {
                if (walkMode) {
                    exitWalkMode();

                    return;
                }

                enterWalkMode();

                if (activeView.kind !== 'threeD') {
                    openView('threeD:default');
                }

                return;
            }

            setViewSetting(setting, !settings[setting]);
        },
        [
            activeView.kind,
            enterWalkMode,
            exitWalkMode,
            openView,
            setViewSetting,
            setViewSettings,
            settings,
            walkMode,
        ],
    );

    /**
     * Write the model to this computer. This is the real save — the drawing
     * lives here, not on the server.
     */
    const saveLocally = useCallback(async () => {
        const revision = store.revision;

        setSaveState('saving');

        try {
            const record = await vault.write(projectId, document, revision);

            store.markSaved(revision);
            setSavedAt(record.savedAt);
            setSaveState('saved');
        } catch {
            setSaveState('error');
        }
    }, [document, projectId, store, vault]);

    /**
     * Send the server a preview of one level and the counts for the whole
     * model, which is all the projects page and the dashboard need.
     *
     * A failure here costs a stale thumbnail, nothing more, so it never
     * reports as a failed save — the drawing is already safe on the machine.
     */
    const publish = useCallback(async () => {
        const preview = buildPreview(document);

        if (!preview) {
            return;
        }

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
                body: JSON.stringify({
                    document: preview,
                    summary: summarise(document),
                    // The client portal walks every level, so it cannot be
                    // served from the one-level preview above.
                    client_model: buildClientModel(document),
                }),
            });

            if (!response.ok) {
                throw new Error(
                    `Publish failed with status ${response.status}`,
                );
            }
        } catch {
            setStatus(
                'Preview not sent — the drawing is safe on this computer',
            );
        }
    }, [document, saveUrl]);

    /** Ctrl+S: put it down here, then bring the projects page up to date. */
    const save = useCallback(async () => {
        await saveLocally();
        await publish();
    }, [publish, saveLocally]);

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
                case 'askAssistant':
                    setCodeAssistantOpen(true);
                    break;
                case 'pinSelection':
                case 'unpinSelection': {
                    if (selection.length === 0) {
                        setStatus('Select something to pin first');
                        break;
                    }

                    const pinning = command === 'pinSelection';

                    store.commit(pinning ? 'Pin' : 'Unpin', (current) =>
                        withPinned(current, selection, pinning),
                    );
                    setStatus(
                        pinning
                            ? `Pinned ${selection.length} — it will refuse to move until unpinned`
                            : `Unpinned ${selection.length}`,
                    );
                    break;
                }
                case 'createSimilar': {
                    const source = document.elements.find(
                        (element) => element.id === selection[0],
                    );
                    const tool = source ? toolForKind(source.kind) : null;

                    if (!source || !tool) {
                        setStatus('Select an element to create similar');
                        break;
                    }

                    if (source.kind === 'fixture') {
                        setFixtureCategory(source.category);
                    }

                    setTool(tool);
                    setStatus(`Placing more: ${tool}`);
                    break;
                }
                case 'matchType': {
                    const matched = withMatchedTypes(document, selection);

                    if (matched.changed === 0) {
                        setStatus(
                            'Select a source element first, then the elements of the same kind to change',
                        );
                        break;
                    }

                    store.commit('Match type', () => matched.document);
                    setStatus(
                        `Matched ${matched.changed} element${matched.changed === 1 ? '' : 's'} to the first selected`,
                    );
                    break;
                }
                case 'groundLevels':
                    setGroundOpen(true);
                    break;
                case 'reviewWarnings':
                    setWarningsOpen(true);
                    break;
                case 'openLibrary':
                    setLibraryOpen(true);
                    break;
                case 'cleanUpModel': {
                    const cleaned = cleanUpDocument(document);

                    if (cleaned.changed === 0) {
                        setStatus('Nothing rough to clean — the model is tidy');
                        break;
                    }

                    store.commit('Clean up model', () => cleaned.document);
                    setSelection([]);
                    setStatus(cleaned.fixes.join(' · '));
                    break;
                }
                case 'purgeUnused': {
                    const purged = purgeUnusedTypes(document);

                    if (purged.purged === 0) {
                        setStatus('Nothing to purge — every type is in use');
                        break;
                    }

                    store.commit('Purge unused', () => purged.document);
                    setStatus(
                        `Purged ${purged.purged} unused type${purged.purged === 1 ? '' : 's'}`,
                    );
                    break;
                }
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
                case 'openMaterials':
                    openView('schedule:materials');
                    break;
                case 'wallsToCode': {
                    if (!codeRequirement) {
                        setStatus(
                            'Set the project address first — the code depends on where the building is',
                        );
                        break;
                    }

                    const result = bringWallsUpToCode(
                        document,
                        codeRequirement,
                    );

                    // Concrete and masonry come back here rather than being
                    // altered: thickening them changes the drawing without
                    // changing the answer.
                    const stuck =
                        result.needsInsulation.length > 0
                            ? ` ${result.needsInsulation.join(', ')} needs insulation, which is your call.`
                            : '';

                    if (result.upgraded.length === 0) {
                        setStatus(
                            stuck === ''
                                ? `Exterior walls already meet ${codeRequirement.region}`
                                : `Nothing to thicken.${stuck}`,
                        );
                        break;
                    }

                    store.commit(
                        'Bring walls up to code',
                        () => result.document,
                    );
                    setStatus(
                        `Thickened ${result.upgraded.length} wall ${result.upgraded.length === 1 ? 'type' : 'types'} for ${codeRequirement.region}.${stuck}`,
                    );
                    break;
                }
                case 'playTour': {
                    const path = document.elements.find(
                        (element) =>
                            element.kind === 'walkthrough' &&
                            selection.includes(element.id),
                    );
                    const fallback = document.elements.find(
                        (element) => element.kind === 'walkthrough',
                    );

                    if (!path && !fallback) {
                        setStatus(
                            'Draw a walkthrough path first — View tab, Path',
                        );
                        break;
                    }

                    enterWalkMode();
                    openView('threeD:default');
                    setTourPlaying(true);
                    setStatus('Playing walkthrough — Esc stops the tour');
                    break;
                }
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
            codeRequirement,
            deleteSelection,
            document,
            enterWalkMode,
            hideSelection,
            isolateSelection,
            level.id,
            openView,
            resetTemporaryHide,
            save,
            selection,
            setTool,
            setViewSetting,
            store,
            zoomFit,
        ],
    );

    // Every movement lands on this computer almost at once.
    useEffect(() => {
        if (!store.isDirty) {
            return;
        }

        const timer = window.setTimeout(() => {
            void saveLocally();
        }, LOCAL_SAVE_DELAY);

        return () => window.clearTimeout(timer);
    }, [store.isDirty, store.revision, saveLocally]);

    // The server's preview follows at a walking pace, once the drawing rests.
    useEffect(() => {
        if (store.revision === publishedRevision.current) {
            return;
        }

        const timer = window.setTimeout(() => {
            publishedRevision.current = store.revision;
            void publish();
        }, PUBLISH_DELAY);

        return () => window.clearTimeout(timer);
    }, [store.revision, publish]);

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
        walkMode,
        setWalkMode,
        walk,
        setWalk,
        tourPlaying,
        jurisdiction,
        codeRequirement,
        explodeFactor,
        setExplodeFactor,
        explodeFocus,
        explodedParts,
        setTourPlaying,
        enterWalkMode,
        exitWalkMode,
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
        ductWidth,
        setDuctWidth,
        ductSystem,
        setDuctSystem,
        pipeDiameter,
        setPipeDiameter,
        pipeSystem,
        setPipeSystem,
        trayWidth,
        setTrayWidth,
        mepElevation,
        setMepElevation,
        fixtureCategory,
        setFixtureCategory,
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
        codeAssistantOpen,
        setCodeAssistantOpen,
        warningsOpen,
        setWarningsOpen,
        libraryOpen,
        setLibraryOpen,
        groundOpen,
        setGroundOpen,
        hidden,
        revealHidden,
        setRevealHidden,
        hideSelection,
        isolateSelection,
        resetTemporaryHide,
        exportToken,
        projectId,
        vault,
        /** False when this browser cannot hold the drawing past the session. */
        persistent,
        isDrawing: isDrawingView(activeView),
        openView,
        saveViewTemplate,
        applyViewTemplate,
        setViewSetting,
        setViewSettings,
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
