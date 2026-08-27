import { Head, Link } from '@inertiajs/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CodeAssistantDialog } from '@/components/cad/code-assistant-dialog';
import { DrawingCanvas } from '@/components/cad/drawing-canvas';
import { ExportDialog } from '@/components/cad/export-dialog';
import { ImportDialog } from '@/components/cad/import-dialog';
import { LibraryDialog } from '@/components/cad/library-dialog';
import { OptionsBar } from '@/components/cad/options-bar';
import { ProjectBrowser } from '@/components/cad/project-browser';
import { ProjectInfoDialog } from '@/components/cad/project-info-dialog';
import type { ProjectSummary } from '@/components/cad/project-info-dialog';
import { PropertiesPalette } from '@/components/cad/properties-palette';
import { RenderDialog } from '@/components/cad/render-dialog';
import { Ribbon } from '@/components/cad/ribbon';
import { ScheduleView } from '@/components/cad/schedule-view';
import { StatusBar } from '@/components/cad/status-bar';
import { TitleBar } from '@/components/cad/title-bar';
import { ViewControlBar } from '@/components/cad/view-control-bar';
import { WarningsDialog } from '@/components/cad/warnings-dialog';
import { useCadEditor } from '@/hooks/use-cad-editor';
import type { EditorStorage } from '@/hooks/use-cad-editor';
import { elementCategory } from '@/lib/cad/model';
import { contextualTab, SHORTCUTS } from '@/lib/cad/ribbon';
import type { RibbonAction, ToggleId } from '@/lib/cad/ribbon';
import { downloadDrawing, parseDrawing } from '@/lib/cad/transfer';
import type { CadDocument, Point, SnapResult } from '@/lib/cad/types';
import { openVault, vaultIsPersistent } from '@/lib/cad/vault';
import { index as projectsIndex } from '@/routes/projects';
import { update as updateDocument } from '@/routes/projects/document';

type EditorProps = {
    project: ProjectSummary & { updated_at: string | null };
    /** The whole model, but only until the drawing has a home; then null. */
    document: CadDocument | null;
    hasLocalModel: boolean;
    /** False until there is an OpenRouter key for the code consultant. */
    assistantReady: boolean;
};

type WorkbenchProps = {
    project: ProjectSummary & { updated_at: string | null };
    document: CadDocument;
    storage: EditorStorage;
    assistantReady: boolean;
};

/**
 * Find the drawing before opening it.
 *
 * The model lives on this computer, so the first job is to look in the vault.
 * A project that has never been saved locally still has its whole document on
 * the server, and that copy is adopted here — which is how a drawing made on
 * another machine, or made before drawings moved local, comes home.
 */
export default function Editor({
    project,
    document,
    hasLocalModel,
    assistantReady,
}: EditorProps) {
    const [found, setFound] = useState<Resolution>({ state: 'looking' });

    useEffect(() => {
        let cancelled = false;

        void (async () => {
            const vault = await openVault();
            const persistent = vaultIsPersistent();
            const storage = { projectId: project.id, vault, persistent };
            const held = await vault.read(project.id);

            if (cancelled) {
                return;
            }

            if (held) {
                setFound({ state: 'open', document: held.document, storage });

                return;
            }

            if (document) {
                // Never saved here: take the server's copy and make it ours.
                await vault.write(project.id, document, 0);

                if (!cancelled) {
                    setFound({ state: 'open', document, storage });
                }

                return;
            }

            setFound({ state: 'away', storage });
        })();

        return () => {
            cancelled = true;
        };
    }, [project.id, document, hasLocalModel]);

    if (found.state === 'looking') {
        return <Searching name={project.name} />;
    }

    if (found.state === 'away') {
        return <AwayFromHome project={project} storage={found.storage} />;
    }

    return (
        <Workbench
            project={project}
            document={found.document}
            storage={found.storage}
            assistantReady={assistantReady}
        />
    );
}

type Resolution =
    | { state: 'looking' }
    | { state: 'away'; storage: EditorStorage }
    | { state: 'open'; document: CadDocument; storage: EditorStorage };

function Workbench({
    project,
    document,
    storage,
    assistantReady,
}: WorkbenchProps) {
    const editor = useCadEditor(
        document,
        updateDocument(project.id).url,
        storage,
    );
    const [pointer, setPointer] = useState<{
        cursor: Point | null;
        snap: SnapResult | null;
    }>({
        cursor: null,
        snap: null,
    });

    const onCursorChange = useCallback(
        (cursor: Point | null, snap: SnapResult | null) =>
            setPointer({ cursor, snap }),
        [],
    );

    const onAction = useCallback(
        (action: RibbonAction) => {
            if (action.kind === 'tool') {
                if (action.fixture) {
                    editor.setFixtureCategory(action.fixture);
                }

                editor.setTool(action.tool);

                return;
            }

            if (action.kind === 'toggle') {
                editor.applyToggle(action.setting);

                return;
            }

            // The hook holds the model but not the project's name, and the
            // file wants to be called after the project.
            if (action.command === 'downloadDrawing') {
                downloadDrawing(editor.document, project.name);
                editor.setStatus(
                    'Drawing saved — carry it to the other computer',
                );

                return;
            }

            editor.runCommand(action.command);
        },
        [editor, project.name],
    );

    const isToggled = useCallback(
        (setting: ToggleId): boolean => {
            if (setting === 'ortho') {
                return editor.ortho;
            }

            if (setting === 'snaps') {
                return editor.snapsEnabled;
            }

            if (setting === 'revealHidden') {
                return editor.revealHidden;
            }

            if (setting === 'walkMode') {
                return editor.walkMode;
            }

            return editor.settings[setting];
        },
        [editor],
    );

    const isDisabled = useCallback(
        (action: RibbonAction): boolean => {
            if (action.kind === 'command') {
                if (action.command === 'undo') {
                    return !editor.store.canUndo;
                }

                if (action.command === 'redo') {
                    return !editor.store.canRedo;
                }

                if (action.command === 'delete') {
                    return editor.selection.length === 0;
                }
            }

            // Drawing tools only make sense in a plan view.
            if (action.kind === 'tool' && !editor.isDrawing) {
                return action.tool !== 'select';
            }

            return false;
        },
        [editor],
    );

    /**
     * Revit titles the contextual tab after the selected category, or
     * `Multi-Select` when the selection spans more than one.
     */
    const contextual = useMemo(() => {
        if (editor.selection.length === 0) {
            return null;
        }

        const categories = new Set(
            editor.document.elements
                .filter((element) => editor.selection.includes(element.id))
                .map((element) => elementCategory(element.kind)),
        );

        if (categories.size === 0) {
            return null;
        }

        return contextualTab(
            categories.size === 1 ? [...categories][0] : 'Multi-Select',
        );
    }, [editor.document.elements, editor.selection]);

    useKeyboardShortcuts(editor);

    return (
        <div className="flex h-screen flex-col overflow-hidden bg-chrome font-sans text-chrome-fg">
            <Head title={`${project.name} — ${editor.activeView.name}`} />

            <TitleBar
                projectName={project.name}
                projectNumber={project.number}
                viewName={editor.activeView.name}
                saveState={editor.saveState}
                isDirty={editor.store.isDirty}
                canUndo={editor.store.canUndo}
                canRedo={editor.store.canRedo}
                onSave={() => editor.runCommand('save')}
                onUndo={() => editor.runCommand('undo')}
                onRedo={() => editor.runCommand('redo')}
                onZoomFit={editor.zoomFit}
                onOpenThreeD={() => editor.runCommand('openThreeD')}
                onMeasure={() => editor.setTool('measure')}
                onExportImage={() => editor.runCommand('export')}
                onProjectInfo={() => editor.runCommand('projectInfo')}
            />

            <Ribbon
                activeTool={editor.tool}
                activeFixture={editor.fixtureCategory}
                contextualTab={contextual}
                isToggled={isToggled}
                isDisabled={isDisabled}
                onAction={onAction}
            />

            <OptionsBar editor={editor} />

            <div className="flex min-h-0 flex-1">
                <aside className="flex w-72 shrink-0 flex-col border-r border-chrome-border">
                    <div className="h-[46%] min-h-0 border-b border-chrome-border">
                        <PropertiesPalette editor={editor} />
                    </div>
                    <div className="min-h-0 flex-1">
                        <ProjectBrowser
                            document={editor.document}
                            groups={editor.groups}
                            activeViewId={editor.activeViewId}
                            onOpenView={editor.openView}
                        />
                    </div>
                </aside>

                <main className="flex min-w-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1">
                        {editor.activeView.kind === 'schedule' ? (
                            <ScheduleView
                                editor={editor}
                                kind={editor.activeView.schedule ?? 'room'}
                            />
                        ) : (
                            <DrawingCanvas
                                editor={editor}
                                onCursorChange={onCursorChange}
                            />
                        )}
                    </div>

                    {editor.activeView.kind !== 'schedule' && (
                        <ViewControlBar editor={editor} />
                    )}
                </main>
            </div>

            <StatusBar
                editor={editor}
                cursor={pointer.cursor}
                snap={pointer.snap}
            />

            <ProjectInfoDialog
                project={project}
                open={editor.projectInfoOpen}
                onOpenChange={editor.setProjectInfoOpen}
            />

            <ImportDialog
                editor={editor}
                open={editor.importOpen}
                onOpenChange={editor.setImportOpen}
            />

            <ExportDialog
                editor={editor}
                projectName={project.name}
                open={editor.exportOpen}
                onOpenChange={editor.setExportOpen}
            />

            <RenderDialog
                editor={editor}
                projectId={project.id}
                projectName={project.name}
                open={editor.renderOpen}
                onOpenChange={editor.setRenderOpen}
            />

            <CodeAssistantDialog
                editor={editor}
                projectId={project.id}
                jurisdiction={project.jurisdiction}
                configured={assistantReady}
                open={editor.codeAssistantOpen}
                onOpenChange={editor.setCodeAssistantOpen}
            />

            <WarningsDialog
                editor={editor}
                open={editor.warningsOpen}
                onOpenChange={editor.setWarningsOpen}
            />

            <LibraryDialog
                editor={editor}
                open={editor.libraryOpen}
                onOpenChange={editor.setLibraryOpen}
            />
        </div>
    );
}

/* ------------------------------------------------- before the drawing opens */

function Searching({ name }: { name: string }) {
    return (
        <div className="flex h-screen items-center justify-center bg-chrome text-chrome-fg">
            <p className="animate-pulse text-sm text-chrome-muted">
                Looking for {name} on this computer…
            </p>
        </div>
    );
}

/**
 * The project exists, but its model was drawn on another machine.
 *
 * Nothing here reaches for the server: the drawing genuinely is not there,
 * so the only way in is the file the other computer exports.
 */
function AwayFromHome({
    project,
    storage,
}: {
    project: ProjectSummary;
    storage: EditorStorage;
}) {
    const [failure, setFailure] = useState<string | null>(null);
    const [reading, setReading] = useState(false);

    async function take(file: File) {
        setReading(true);
        setFailure(null);

        try {
            const drawing = parseDrawing(await file.text());

            await storage.vault.write(project.id, drawing, 0);
            // Straight back through the loader, which will now find it.
            window.location.reload();
        } catch (problem) {
            setFailure(
                problem instanceof Error
                    ? problem.message
                    : 'That file could not be read.',
            );
            setReading(false);
        }
    }

    return (
        <div className="flex h-screen flex-col items-center justify-center gap-6 bg-chrome px-6 text-chrome-fg">
            <div className="max-w-lg text-center">
                <p className="ax-eyebrow text-[0.6rem] text-chrome-muted">
                    {project.name}
                </p>
                <h1 className="mt-3 text-xl font-light">
                    This drawing is not on this computer
                </h1>
                <p className="mt-4 text-sm text-chrome-muted">
                    Models are kept on the machine that drew them, so only the
                    thumbnail and the counts travel. Open the project on the
                    computer that has it, choose{' '}
                    <span className="text-chrome-fg">Download drawing</span>,
                    then bring the file here.
                </p>
            </div>

            <label className="cursor-pointer rounded-sm border border-chrome-border bg-chrome-raised px-4 py-2 text-sm transition-colors hover:border-sand">
                <input
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    disabled={reading}
                    onChange={(event) => {
                        const file = event.target.files?.[0];

                        if (file) {
                            void take(file);
                        }
                    }}
                />
                {reading ? 'Opening…' : 'Open a drawing file'}
            </label>

            {failure && (
                <p className="max-w-lg text-center text-sm text-destructive">
                    {failure}
                </p>
            )}

            <Link
                href={projectsIndex()}
                className="text-xs text-chrome-muted underline underline-offset-4 hover:text-chrome-fg"
            >
                Back to projects
            </Link>
        </div>
    );
}

/**
 * Revit's accelerators: single keys for the common commands and two letter
 * pairs like WA or DR for the tools.
 */
function useKeyboardShortcuts(editor: ReturnType<typeof useCadEditor>) {
    const buffer = useRef<{ keys: string; at: number }>({ keys: '', at: 0 });

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;

            if (
                target &&
                (target.tagName === 'INPUT' ||
                    target.tagName === 'SELECT' ||
                    target.tagName === 'TEXTAREA' ||
                    target.isContentEditable)
            ) {
                return;
            }

            if (event.ctrlKey || event.metaKey) {
                const key = event.key.toLowerCase();

                if (key === 's') {
                    event.preventDefault();
                    editor.runCommand('save');
                }

                if (key === 'z') {
                    event.preventDefault();
                    editor.runCommand(event.shiftKey ? 'redo' : 'undo');
                }

                if (key === 'y') {
                    event.preventDefault();
                    editor.runCommand('redo');
                }

                return;
            }

            if (event.key === 'Delete' || event.key === 'Backspace') {
                event.preventDefault();
                editor.deleteSelection();

                return;
            }

            if (event.key === 'Escape') {
                if (editor.walkMode) {
                    editor.exitWalkMode();

                    return;
                }

                editor.setTool('select');
                editor.clearSelection();

                return;
            }

            // While walking, letters steer the camera rather than the ribbon.
            if (editor.walkMode) {
                return;
            }

            if (!/^[a-z]$/i.test(event.key)) {
                return;
            }

            const now = Date.now();
            const keys =
                now - buffer.current.at > 900
                    ? event.key.toLowerCase()
                    : `${buffer.current.keys}${event.key.toLowerCase()}`.slice(
                          -2,
                      );

            buffer.current = { keys, at: now };

            const action = SHORTCUTS[keys];

            if (!action) {
                return;
            }

            buffer.current = { keys: '', at: 0 };

            if (action.kind === 'tool') {
                if (action.fixture) {
                    editor.setFixtureCategory(action.fixture);
                }

                editor.setTool(action.tool);
            } else if (action.kind === 'toggle') {
                editor.applyToggle(action.setting);
            } else {
                editor.runCommand(action.command);
            }
        };

        window.addEventListener('keydown', onKeyDown);

        return () => window.removeEventListener('keydown', onKeyDown);
    }, [editor]);
}
