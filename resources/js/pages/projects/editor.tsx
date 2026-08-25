import { Head } from '@inertiajs/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DrawingCanvas } from '@/components/cad/drawing-canvas';
import { ExportDialog } from '@/components/cad/export-dialog';
import { ImportDialog } from '@/components/cad/import-dialog';
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
import { useCadEditor } from '@/hooks/use-cad-editor';
import { elementCategory } from '@/lib/cad/model';
import { contextualTab, SHORTCUTS } from '@/lib/cad/ribbon';
import type { RibbonAction, ToggleId } from '@/lib/cad/ribbon';
import type { CadDocument, Point, SnapResult } from '@/lib/cad/types';
import { update as updateDocument } from '@/routes/projects/document';

type EditorProps = {
    project: ProjectSummary & { updated_at: string | null };
    document: CadDocument;
};

export default function Editor({ project, document }: EditorProps) {
    const editor = useCadEditor(document, updateDocument(project.id).url);
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
                editor.setTool(action.tool);

                return;
            }

            if (action.kind === 'toggle') {
                editor.applyToggle(action.setting);

                return;
            }

            editor.runCommand(action.command);
        },
        [editor],
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
                editor.setTool('select');
                editor.clearSelection();

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
