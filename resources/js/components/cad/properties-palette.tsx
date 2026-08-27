import { FlipHorizontal2, FlipVertical2, Pin, PinOff } from 'lucide-react';
import { PanelHeading } from '@/components/cad/project-browser';
import type { CadEditor } from '@/hooks/use-cad-editor';
import { distance, polygonArea, polygonPerimeter } from '@/lib/cad/geometry';
import {
    DUCT_SYSTEM_LABELS,
    elementCategory,
    elementDisplayName,
    FIXTURE_CATEGORY_LABELS,
    maxOpeningWidth,
    MIN_OPENING_HEIGHT,
    openingIsResized,
    openingSize,
    openingTypeSize,
    PIPE_SYSTEM_LABELS,
    resizeOpening,
    wallTypeOf,
    withPatchedElement,
} from '@/lib/cad/model';
import type {
    CadElement,
    DetailLevel,
    DuctSystem,
    ElementKind,
    LocationLine,
    OpeningElement,
    PipeSystem,
    ViewSettings,
    VisualStyle,
} from '@/lib/cad/types';
import { formatArea, formatLength, parseLength } from '@/lib/cad/units';
import { VIEW_SCALES } from '@/lib/cad/views';
import { cn } from '@/lib/utils';

export function PropertiesPalette({ editor }: { editor: CadEditor }) {
    const selected = editor.document.elements.filter((element) =>
        editor.selection.includes(element.id),
    );

    return (
        <div className="flex h-full flex-col overflow-hidden bg-chrome text-chrome-fg">
            <PanelHeading>Properties</PanelHeading>

            <div className="flex-1 scrollbar-chrome overflow-y-auto pb-4 text-[0.78rem]">
                {selected.length === 0 && <ViewProperties editor={editor} />}
                {selected.length === 1 && (
                    <ElementProperties editor={editor} element={selected[0]} />
                )}
                {selected.length > 1 && (
                    <div className="p-3">
                        <Banner
                            title={`${selected.length} elements selected`}
                            subtitle={summariseCategories(selected)}
                        />
                        <Group title="Actions">
                            <div className="px-3 pb-3">
                                <button
                                    type="button"
                                    onClick={editor.deleteSelection}
                                    className="w-full rounded-sm border border-destructive/50 px-2 py-1.5 text-[0.75rem] text-destructive transition-colors hover:bg-destructive/10"
                                >
                                    Delete selection
                                </button>
                            </div>
                        </Group>
                    </div>
                )}
            </div>
        </div>
    );
}

function summariseCategories(elements: CadElement[]): string {
    const counts = new Map<string, number>();

    elements.forEach((element) => {
        const category = elementCategory(element.kind);
        counts.set(category, (counts.get(category) ?? 0) + 1);
    });

    return [...counts.entries()]
        .map(([category, count]) => `${category} (${count})`)
        .join(', ');
}

function ViewProperties({ editor }: { editor: CadEditor }) {
    const { activeView, settings, setViewSetting, level } = editor;

    return (
        <div>
            <Banner
                title={activeView.name}
                subtitle={viewKindLabel(activeView.kind)}
            />

            <Group title="Graphics">
                <Row label="View Scale">
                    <Select
                        value={String(settings.scale)}
                        options={VIEW_SCALES.map((scale) => ({
                            value: String(scale),
                            label: `1 : ${scale}`,
                        }))}
                        onChange={(value) =>
                            setViewSetting('scale', Number(value))
                        }
                    />
                </Row>
                <Row label="Detail Level">
                    <Select
                        value={settings.detailLevel}
                        options={[
                            { value: 'coarse', label: 'Coarse' },
                            { value: 'medium', label: 'Medium' },
                            { value: 'fine', label: 'Fine' },
                        ]}
                        onChange={(value) =>
                            setViewSetting('detailLevel', value as DetailLevel)
                        }
                    />
                </Row>
                <Row label="Visual Style">
                    <Select
                        value={settings.visualStyle}
                        options={[
                            { value: 'wireframe', label: 'Wireframe' },
                            { value: 'hiddenLine', label: 'Hidden Line' },
                            { value: 'shaded', label: 'Shaded' },
                            { value: 'realistic', label: 'Realistic' },
                        ]}
                        onChange={(value) =>
                            setViewSetting('visualStyle', value as VisualStyle)
                        }
                    />
                </Row>
                <Row label="Grid">
                    <Toggle
                        value={settings.showGrid}
                        onChange={(value) => setViewSetting('showGrid', value)}
                    />
                </Row>
                <Row label="Room Fill">
                    <Toggle
                        value={settings.showRooms}
                        onChange={(value) => setViewSetting('showRooms', value)}
                    />
                </Row>
                <Row label="Annotation">
                    <Toggle
                        value={settings.showTags}
                        onChange={(value) => setViewSetting('showTags', value)}
                    />
                </Row>
                <Row label="Underlay">
                    <Toggle
                        value={settings.underlay}
                        onChange={(value) => setViewSetting('underlay', value)}
                    />
                </Row>
            </Group>

            <Group title="Phasing">
                <Row label="Phase Filter">
                    <Select
                        value={settings.phaseFilter}
                        options={[
                            { value: 'all', label: 'Show All' },
                            { value: 'new', label: 'Show New' },
                            { value: 'existing', label: 'Show Existing' },
                        ]}
                        onChange={(value) =>
                            setViewSetting(
                                'phaseFilter',
                                value as ViewSettings['phaseFilter'],
                            )
                        }
                    />
                </Row>
            </Group>

            <VisibilityGraphics editor={editor} />
            <ViewTemplates editor={editor} />

            <Group title="Extents">
                <Row label="Associated Level">
                    <ReadOnly value={level.name} />
                </Row>
                <Row label="Level Elevation">
                    <ReadOnly
                        value={formatLength(
                            level.elevation,
                            editor.document.units,
                        )}
                    />
                </Row>
            </Group>
        </div>
    );
}

/** Categories offered in the per-view Visibility/Graphics list. */
const VG_CATEGORIES: ElementKind[] = [
    'wall',
    'door',
    'window',
    'floor',
    'column',
    'beam',
    'brace',
    'footing',
    'roof',
    'ceiling',
    'stair',
    'ramp',
    'railing',
    'room',
    'duct',
    'pipe',
    'cableTray',
    'fixture',
    'pad',
    'toposurface',
    'propertyLine',
    'grid',
    'referencePlane',
    'dimension',
    'text',
    'spotElevation',
    'walkthrough',
    'revisionCloud',
    'section',
    'mesh',
];

/**
 * Per-view category visibility, the heart of Revit's Visibility/Graphics
 * dialog reduced to what this model has.
 */
function VisibilityGraphics({ editor }: { editor: CadEditor }) {
    const { settings, setViewSetting } = editor;
    const hidden = settings.hiddenCategories;

    const toggleCategory = (kind: ElementKind, visible: boolean) => {
        setViewSetting(
            'hiddenCategories',
            visible
                ? hidden.filter((item) => item !== kind)
                : [...hidden, kind],
        );
    };

    return (
        <Group title="Visibility / Graphics">
            {VG_CATEGORIES.map((kind) => (
                <Row key={kind} label={elementCategory(kind)}>
                    <Toggle
                        value={!hidden.includes(kind)}
                        onChange={(value) => toggleCategory(kind, value)}
                    />
                </Row>
            ))}
        </Group>
    );
}

/** Save the active view's settings as a template, or apply a saved one. */
function ViewTemplates({ editor }: { editor: CadEditor }) {
    const templates = editor.document.viewTemplates ?? [];

    return (
        <Group title="View Template">
            {templates.length > 0 && (
                <Row label="Apply">
                    <Select
                        value=""
                        options={[
                            { value: '', label: 'Choose…' },
                            ...templates.map((template) => ({
                                value: template.id,
                                label: template.name,
                            })),
                        ]}
                        onChange={(value) => {
                            if (value !== '') {
                                editor.applyViewTemplate(value);
                            }
                        }}
                    />
                </Row>
            )}
            <div className="px-3 pb-3">
                <button
                    type="button"
                    onClick={() => {
                        const name = window.prompt(
                            'Name for this view template:',
                            `${editor.activeView.name} template`,
                        );

                        if (name && name.trim() !== '') {
                            editor.saveViewTemplate(name.trim());
                        }
                    }}
                    className="w-full rounded-sm border border-chrome-border px-2 py-1.5 text-[0.75rem] text-chrome-fg transition-colors hover:bg-chrome-raised"
                >
                    Save current settings as template
                </button>
            </div>
        </Group>
    );
}

function viewKindLabel(kind: string): string {
    const labels: Record<string, string> = {
        plan: 'Floor Plan',
        ceiling: 'Ceiling Plan',
        elevation: 'Elevation',
        section: 'Section',
        threeD: '3D View',
        schedule: 'Schedule',
    };

    return labels[kind] ?? kind;
}

type ElementPropertiesProps = {
    editor: CadEditor;
    element: CadElement;
};

function ElementProperties({ editor, element }: ElementPropertiesProps) {
    const { document, store } = editor;
    const units = document.units;

    const patch = (values: Record<string, unknown>) =>
        store.commit('Modify element', (current) =>
            withPatchedElement(current, element.id, values as never),
        );

    return (
        <div>
            <Banner
                title={elementDisplayName(document, element)}
                subtitle={elementCategory(element.kind)}
            />

            <Group title="Phasing">
                <Row label="Phase">
                    <Select
                        value={element.phase ?? 'new'}
                        options={[
                            { value: 'new', label: 'New Construction' },
                            { value: 'existing', label: 'Existing' },
                            { value: 'demolished', label: 'Demolished' },
                        ]}
                        onChange={(value) => patch({ phase: value })}
                    />
                </Row>
            </Group>

            {element.kind === 'wall' && (
                <>
                    <Group title="Type">
                        <Row label="Wall Type">
                            <Select
                                value={element.typeId}
                                options={document.wallTypes.map((type) => ({
                                    value: type.id,
                                    label: type.name,
                                }))}
                                onChange={(value) => patch({ typeId: value })}
                            />
                        </Row>
                        <Row label="Thickness">
                            <ReadOnly
                                value={formatLength(
                                    wallTypeOf(document, element.typeId)
                                        .thickness,
                                    units,
                                )}
                            />
                        </Row>
                    </Group>

                    <Group title="Constraints">
                        <Row label="Base Level">
                            <Select
                                value={element.level}
                                options={document.levels.map((level) => ({
                                    value: level.id,
                                    label: level.name,
                                }))}
                                onChange={(value) => patch({ level: value })}
                            />
                        </Row>
                        <Row label="Base Offset">
                            <LengthField
                                value={element.baseOffset}
                                units={units}
                                allowNegative
                                onCommit={(value) =>
                                    patch({ baseOffset: value })
                                }
                            />
                        </Row>
                        <Row label="Unconnected Height">
                            <LengthField
                                value={element.height}
                                units={units}
                                onCommit={(value) => patch({ height: value })}
                            />
                        </Row>
                        <Row label="Location Line">
                            <Select
                                value={element.locationLine}
                                options={[
                                    {
                                        value: 'center',
                                        label: 'Wall Centreline',
                                    },
                                    {
                                        value: 'left',
                                        label: 'Finish Face: Exterior',
                                    },
                                    {
                                        value: 'right',
                                        label: 'Finish Face: Interior',
                                    },
                                ]}
                                onChange={(value) =>
                                    patch({
                                        locationLine: value as LocationLine,
                                    })
                                }
                            />
                        </Row>
                    </Group>

                    <Group title="Dimensions">
                        <Row label="Length">
                            <ReadOnly
                                value={formatLength(
                                    distance(element.a, element.b),
                                    units,
                                )}
                            />
                        </Row>
                        <Row label="Area">
                            <ReadOnly
                                value={formatArea(
                                    distance(element.a, element.b) *
                                        element.height,
                                    units,
                                )}
                            />
                        </Row>
                    </Group>
                </>
            )}

            {(element.kind === 'door' || element.kind === 'window') && (
                <OpeningProperties
                    editor={editor}
                    element={element}
                    patch={patch}
                />
            )}

            {element.kind === 'room' && (
                <>
                    <Group title="Identity Data">
                        <Row label="Name">
                            <TextField
                                value={element.name}
                                onCommit={(value) => patch({ name: value })}
                            />
                        </Row>
                        <Row label="Number">
                            <TextField
                                value={element.number}
                                onCommit={(value) => patch({ number: value })}
                            />
                        </Row>
                    </Group>
                    <Group title="Dimensions">
                        <Row label="Area">
                            <ReadOnly
                                value={
                                    editor.rooms.get(element.id)
                                        ? formatArea(
                                              editor.rooms.get(element.id)!
                                                  .area,
                                              units,
                                          )
                                        : 'Not Enclosed'
                                }
                            />
                        </Row>
                        <Row label="Perimeter">
                            <ReadOnly
                                value={
                                    editor.rooms.get(element.id)
                                        ? formatLength(
                                              editor.rooms.get(element.id)!
                                                  .perimeter,
                                              units,
                                          )
                                        : '—'
                                }
                            />
                        </Row>
                    </Group>
                </>
            )}

            {element.kind === 'column' && (
                <Group title="Dimensions">
                    <Row label="Size">
                        <LengthField
                            value={element.size}
                            units={units}
                            onCommit={(value) => patch({ size: value })}
                        />
                    </Row>
                    <Row label="Height">
                        <LengthField
                            value={element.height}
                            units={units}
                            onCommit={(value) => patch({ height: value })}
                        />
                    </Row>
                </Group>
            )}

            {element.kind === 'floor' && (
                <Group title="Dimensions">
                    <Row label="Thickness">
                        <LengthField
                            value={element.thickness}
                            units={units}
                            onCommit={(value) => patch({ thickness: value })}
                        />
                    </Row>
                    <Row label="Height Offset">
                        <LengthField
                            value={element.offset}
                            units={units}
                            allowNegative
                            onCommit={(value) => patch({ offset: value })}
                        />
                    </Row>
                </Group>
            )}

            {element.kind === 'roof' && (
                <Group title="Dimensions">
                    <Row label="Slope">
                        <TextField
                            value={String(element.slope)}
                            onCommit={(value) => {
                                const slope = Number.parseFloat(value);

                                if (Number.isFinite(slope)) {
                                    patch({
                                        slope: Math.min(Math.max(slope, 5), 75),
                                    });
                                }
                            }}
                        />
                    </Row>
                    <Row label="Overhang">
                        <LengthField
                            value={element.overhang}
                            units={units}
                            onCommit={(value) => patch({ overhang: value })}
                        />
                    </Row>
                    <Row label="Plate Height">
                        <LengthField
                            value={element.baseOffset}
                            units={units}
                            onCommit={(value) => patch({ baseOffset: value })}
                        />
                    </Row>
                </Group>
            )}

            {element.kind === 'ceiling' && (
                <Group title="Dimensions">
                    <Row label="Height Offset">
                        <LengthField
                            value={element.heightOffset}
                            units={units}
                            onCommit={(value) => patch({ heightOffset: value })}
                        />
                    </Row>
                </Group>
            )}

            {element.kind === 'stair' && (
                <Group title="Dimensions">
                    <Row label="Width">
                        <LengthField
                            value={element.width}
                            units={units}
                            onCommit={(value) => patch({ width: value })}
                        />
                    </Row>
                    <Row label="Total Rise">
                        <LengthField
                            value={element.rise}
                            units={units}
                            onCommit={(value) => patch({ rise: value })}
                        />
                    </Row>
                    <Row label="Run Length">
                        <ReadOnly
                            value={formatLength(
                                distance(element.a, element.b),
                                units,
                            )}
                        />
                    </Row>
                </Group>
            )}

            {element.kind === 'grid' && (
                <Group title="Identity Data">
                    <Row label="Name">
                        <TextField
                            value={element.label}
                            onCommit={(value) => patch({ label: value })}
                        />
                    </Row>
                </Group>
            )}

            {element.kind === 'beam' && (
                <Group title="Dimensions">
                    <Row label="Width">
                        <LengthField
                            value={element.width}
                            units={units}
                            onCommit={(value) => patch({ width: value })}
                        />
                    </Row>
                    <Row label="Depth">
                        <LengthField
                            value={element.depth}
                            units={units}
                            onCommit={(value) => patch({ depth: value })}
                        />
                    </Row>
                    <Row label="Elevation">
                        <LengthField
                            value={element.elevation}
                            units={units}
                            allowNegative
                            onCommit={(value) => patch({ elevation: value })}
                        />
                    </Row>
                </Group>
            )}

            {element.kind === 'ramp' && (
                <Group title="Dimensions">
                    <Row label="Width">
                        <LengthField
                            value={element.width}
                            units={units}
                            onCommit={(value) => patch({ width: value })}
                        />
                    </Row>
                    <Row label="Total Rise">
                        <LengthField
                            value={element.rise}
                            units={units}
                            onCommit={(value) => patch({ rise: value })}
                        />
                    </Row>
                </Group>
            )}

            {element.kind === 'referencePlane' && (
                <Group title="Identity Data">
                    <Row label="Name">
                        <TextField
                            value={element.name}
                            onCommit={(value) => patch({ name: value })}
                        />
                    </Row>
                </Group>
            )}

            {element.kind === 'section' && (
                <Group title="Identity Data">
                    <Row label="View Name">
                        <TextField
                            value={element.name}
                            onCommit={(value) => patch({ name: value })}
                        />
                    </Row>
                </Group>
            )}

            {element.kind === 'revisionCloud' && (
                <Group title="Identity Data">
                    <Row label="Revision">
                        <TextField
                            value={element.revision}
                            onCommit={(value) => patch({ revision: value })}
                        />
                    </Row>
                </Group>
            )}

            {element.kind === 'text' && (
                <Group title="Text">
                    <Row label="Value">
                        <TextField
                            value={element.value}
                            onCommit={(value) => patch({ value })}
                        />
                    </Row>
                    <Row label="Size">
                        <LengthField
                            value={element.size}
                            units={units}
                            onCommit={(value) => patch({ size: value })}
                        />
                    </Row>
                </Group>
            )}

            {element.kind === 'dimension' && (
                <Group title="Dimensions">
                    <Row label="Value">
                        <ReadOnly
                            value={formatLength(
                                distance(element.a, element.b),
                                units,
                            )}
                        />
                    </Row>
                    <Row label="Witness Offset">
                        <LengthField
                            value={element.offset}
                            units={units}
                            allowNegative
                            onCommit={(value) => patch({ offset: value })}
                        />
                    </Row>
                </Group>
            )}

            {element.kind === 'line' && (
                <Group title="Dimensions">
                    <Row label="Length">
                        <ReadOnly
                            value={formatLength(
                                distance(element.a, element.b),
                                units,
                            )}
                        />
                    </Row>
                </Group>
            )}

            {element.kind === 'railing' && (
                <Group title="Dimensions">
                    <Row label="Height">
                        <LengthField
                            value={element.height}
                            units={units}
                            onCommit={(value) => patch({ height: value })}
                        />
                    </Row>
                    <Row label="Length">
                        <ReadOnly
                            value={formatLength(
                                distance(element.a, element.b),
                                units,
                            )}
                        />
                    </Row>
                </Group>
            )}

            {element.kind === 'brace' && (
                <Group title="Dimensions">
                    <Row label="Section">
                        <LengthField
                            value={element.width}
                            units={units}
                            onCommit={(value) => patch({ width: value })}
                        />
                    </Row>
                    <Row label="Rise">
                        <LengthField
                            value={element.rise}
                            units={units}
                            onCommit={(value) => patch({ rise: value })}
                        />
                    </Row>
                </Group>
            )}

            {element.kind === 'footing' && (
                <Group title="Dimensions">
                    <Row label="Width">
                        <LengthField
                            value={element.width}
                            units={units}
                            onCommit={(value) => patch({ width: value })}
                        />
                    </Row>
                    <Row label="Depth">
                        <LengthField
                            value={element.depth}
                            units={units}
                            onCommit={(value) => patch({ depth: value })}
                        />
                    </Row>
                </Group>
            )}

            {element.kind === 'duct' && (
                <>
                    <Group title="Mechanical">
                        <Row label="System">
                            <Select
                                value={element.system}
                                options={Object.entries(DUCT_SYSTEM_LABELS).map(
                                    ([value, label]) => ({ value, label }),
                                )}
                                onChange={(value) =>
                                    patch({ system: value as DuctSystem })
                                }
                            />
                        </Row>
                    </Group>
                    <Group title="Dimensions">
                        <Row label="Width">
                            <LengthField
                                value={element.width}
                                units={units}
                                onCommit={(value) => patch({ width: value })}
                            />
                        </Row>
                        <Row label="Elevation">
                            <LengthField
                                value={element.elevation}
                                units={units}
                                allowNegative
                                onCommit={(value) =>
                                    patch({ elevation: value })
                                }
                            />
                        </Row>
                    </Group>
                </>
            )}

            {element.kind === 'pipe' && (
                <>
                    <Group title="Plumbing">
                        <Row label="System">
                            <Select
                                value={element.system}
                                options={Object.entries(PIPE_SYSTEM_LABELS).map(
                                    ([value, label]) => ({ value, label }),
                                )}
                                onChange={(value) =>
                                    patch({ system: value as PipeSystem })
                                }
                            />
                        </Row>
                    </Group>
                    <Group title="Dimensions">
                        <Row label="Diameter">
                            <LengthField
                                value={element.diameter}
                                units={units}
                                onCommit={(value) => patch({ diameter: value })}
                            />
                        </Row>
                        <Row label="Elevation">
                            <LengthField
                                value={element.elevation}
                                units={units}
                                allowNegative
                                onCommit={(value) =>
                                    patch({ elevation: value })
                                }
                            />
                        </Row>
                    </Group>
                </>
            )}

            {element.kind === 'cableTray' && (
                <Group title="Dimensions">
                    <Row label="Width">
                        <LengthField
                            value={element.width}
                            units={units}
                            onCommit={(value) => patch({ width: value })}
                        />
                    </Row>
                    <Row label="Elevation">
                        <LengthField
                            value={element.elevation}
                            units={units}
                            allowNegative
                            onCommit={(value) => patch({ elevation: value })}
                        />
                    </Row>
                </Group>
            )}

            {element.kind === 'fixture' && (
                <>
                    <Group title="Identity Data">
                        <Row label="Name">
                            <TextField
                                value={element.name}
                                onCommit={(value) => patch({ name: value })}
                            />
                        </Row>
                        <Row label="Category">
                            <ReadOnly
                                value={
                                    FIXTURE_CATEGORY_LABELS[element.category]
                                }
                            />
                        </Row>
                    </Group>
                    <Group title="Dimensions">
                        <Row label="Width">
                            <LengthField
                                value={element.width}
                                units={units}
                                onCommit={(value) => patch({ width: value })}
                            />
                        </Row>
                        <Row label="Depth">
                            <LengthField
                                value={element.depth}
                                units={units}
                                onCommit={(value) => patch({ depth: value })}
                            />
                        </Row>
                        <Row label="Height">
                            <LengthField
                                value={element.height}
                                units={units}
                                onCommit={(value) => patch({ height: value })}
                            />
                        </Row>
                        <Row label="Elevation">
                            <LengthField
                                value={element.elevation}
                                units={units}
                                allowNegative
                                onCommit={(value) =>
                                    patch({ elevation: value })
                                }
                            />
                        </Row>
                        <Row label="Rotation">
                            <NumberField
                                value={Math.round(
                                    (element.rotation * 180) / Math.PI,
                                )}
                                onCommit={(value) =>
                                    patch({
                                        rotation: (value * Math.PI) / 180,
                                    })
                                }
                            />
                        </Row>
                    </Group>
                </>
            )}

            {element.kind === 'pad' && (
                <Group title="Dimensions">
                    <Row label="Thickness">
                        <LengthField
                            value={element.thickness}
                            units={units}
                            onCommit={(value) => patch({ thickness: value })}
                        />
                    </Row>
                    <Row label="Area">
                        <ReadOnly
                            value={formatArea(
                                polygonArea(element.points),
                                units,
                            )}
                        />
                    </Row>
                </Group>
            )}

            {element.kind === 'toposurface' && (
                <Group title="Dimensions">
                    <Row label="Ground Depth">
                        <LengthField
                            value={element.depth}
                            units={units}
                            onCommit={(value) => patch({ depth: value })}
                        />
                    </Row>
                    <Row label="Area">
                        <ReadOnly
                            value={formatArea(
                                polygonArea(element.points),
                                units,
                            )}
                        />
                    </Row>
                </Group>
            )}

            {element.kind === 'propertyLine' && (
                <Group title="Dimensions">
                    <Row label="Area">
                        <ReadOnly
                            value={formatArea(
                                polygonArea(element.points),
                                units,
                            )}
                        />
                    </Row>
                    <Row label="Perimeter">
                        <ReadOnly
                            value={formatLength(
                                polygonPerimeter(element.points),
                                units,
                            )}
                        />
                    </Row>
                </Group>
            )}

            {element.kind === 'walkthrough' && (
                <Group title="Camera">
                    <Row label="Eye Height">
                        <LengthField
                            value={element.eyeHeight}
                            units={units}
                            onCommit={(value) => patch({ eyeHeight: value })}
                        />
                    </Row>
                    <Row label="Stops">
                        <ReadOnly value={String(element.points.length)} />
                    </Row>
                    <Row label="Path Length">
                        <ReadOnly
                            value={formatLength(
                                element.points.reduce(
                                    (total, point, index) =>
                                        index === 0
                                            ? total
                                            : total +
                                              distance(
                                                  element.points[index - 1],
                                                  point,
                                              ),
                                    0,
                                ),
                                units,
                            )}
                        />
                    </Row>
                </Group>
            )}

            {element.kind === 'spotElevation' && (
                <Group title="Extents">
                    <Row label="Reports">
                        <ReadOnly
                            value={formatLength(
                                document.levels.find(
                                    (level) => level.id === element.level,
                                )?.elevation ?? 0,
                                units,
                            )}
                        />
                    </Row>
                </Group>
            )}

            {element.kind === 'mesh' && (
                <>
                    <Group title="Identity Data">
                        <Row label="Name">
                            <TextField
                                value={element.name}
                                onCommit={(value) => patch({ name: value })}
                            />
                        </Row>
                        <Row label="Triangles">
                            <ReadOnly
                                value={(
                                    element.vertices.length / 9
                                ).toLocaleString('en-CA')}
                            />
                        </Row>
                    </Group>
                    <Group title="Placement">
                        <Row label="Scale">
                            <NumberField
                                value={element.scale}
                                min={0.001}
                                onCommit={(value) => patch({ scale: value })}
                            />
                        </Row>
                        <Row label="Rotation">
                            <NumberField
                                value={Math.round(
                                    (element.rotation * 180) / Math.PI,
                                )}
                                onCommit={(value) =>
                                    patch({ rotation: (value * Math.PI) / 180 })
                                }
                            />
                        </Row>
                        <Row label="Base Offset">
                            <LengthField
                                value={element.baseOffset}
                                units={units}
                                allowNegative
                                onCommit={(value) =>
                                    patch({ baseOffset: value })
                                }
                            />
                        </Row>
                    </Group>
                    <Group title="Dimensions">
                        <Row label="Size">
                            <ReadOnly
                                value={`${Math.round(element.size.x * element.scale)} × ${Math.round(
                                    element.size.y * element.scale,
                                )} × ${Math.round(element.size.z * element.scale)}`}
                            />
                        </Row>
                    </Group>
                </>
            )}

            <Group title="Identity">
                <Row label="Mark">
                    <TextField
                        value={element.mark ?? ''}
                        onCommit={(value) =>
                            patch({ mark: value.trim() || undefined })
                        }
                    />
                </Row>
                <Row label="Comments">
                    <TextField
                        value={element.comment ?? ''}
                        onCommit={(value) =>
                            patch({ comment: value.trim() || undefined })
                        }
                    />
                </Row>
                <div className="px-3 pt-1 pb-2">
                    <button
                        type="button"
                        onClick={() =>
                            patch({ pinned: element.pinned ? undefined : true })
                        }
                        className={cn(
                            'flex w-full items-center justify-center gap-1.5 rounded-sm border px-2 py-1.5 text-[0.74rem] transition-colors',
                            element.pinned
                                ? 'border-sand text-sand hover:bg-chrome-raised'
                                : 'border-chrome-border text-chrome-muted hover:bg-chrome-raised hover:text-chrome-fg',
                        )}
                    >
                        {element.pinned ? (
                            <>
                                <PinOff className="size-3.5" />
                                Pinned — release
                            </>
                        ) : (
                            <>
                                <Pin className="size-3.5" />
                                Pin in place
                            </>
                        )}
                    </button>
                </div>
            </Group>

            <div className="px-3 pt-2">
                <button
                    type="button"
                    onClick={editor.deleteSelection}
                    className="w-full rounded-sm border border-destructive/50 px-2 py-1.5 text-[0.75rem] text-destructive transition-colors hover:bg-destructive/10"
                >
                    Delete element
                </button>
            </div>
        </div>
    );
}

type OpeningPropertiesProps = {
    editor: CadEditor;
    element: OpeningElement;
    patch: (values: Record<string, unknown>) => void;
};

function OpeningProperties({ editor, element, patch }: OpeningPropertiesProps) {
    const { document } = editor;
    const units = document.units;
    const size = openingSize(document, element);
    const fromType = openingTypeSize(document, element);
    const resized = openingIsResized(element);
    const types =
        element.kind === 'door' ? document.doorTypes : document.windowTypes;

    const host = document.elements.find((item) => item.id === element.host);
    const hostLength =
        host?.kind === 'wall' ? distance(host.a, host.b) : Infinity;

    /**
     * Widening has to move the opening along its host as well, or a wide
     * enough window ends up hanging off the end of the wall.
     */
    const setWidth = (width: number) => {
        const next = resizeOpening(element, size.width, hostLength, width);

        patch({ width: next.width, t: next.t });
    };

    /** Give the instance its type's size back. */
    const useTypeSize = () =>
        patch({
            width: undefined,
            height: undefined,
            sillHeight: undefined,
            t: resizeOpening(element, size.width, hostLength, fromType.width).t,
        });

    return (
        <>
            <Group title="Type">
                <Row
                    label={
                        element.kind === 'door' ? 'Door Type' : 'Window Type'
                    }
                >
                    <Select
                        value={element.typeId}
                        options={types.map((type) => ({
                            value: type.id,
                            label: type.name,
                        }))}
                        // Picking a new type means taking its size with it,
                        // so any instance resize is dropped here.
                        onChange={(value) =>
                            patch({
                                typeId: value,
                                width: undefined,
                                height: undefined,
                                sillHeight: undefined,
                            })
                        }
                    />
                </Row>
            </Group>

            <Group title="Constraints">
                <Row label="Host">
                    <ReadOnly value={hostLabel(editor, element)} />
                </Row>
                <Row label="Position">
                    <div className="flex w-full items-center gap-2">
                        <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.005}
                            value={element.t}
                            onChange={(event) =>
                                patch({ t: Number(event.target.value) })
                            }
                            className="h-1 flex-1 accent-sand"
                        />
                        <span className="w-10 text-right text-chrome-muted">
                            {Math.round(element.t * 100)}%
                        </span>
                    </div>
                </Row>
                <Row
                    label={rowLabel(
                        'Sill Height',
                        element.kind === 'window' &&
                            element.sillHeight !== undefined,
                    )}
                >
                    {element.kind === 'window' ? (
                        <LengthField
                            value={size.sillHeight}
                            units={units}
                            allowNegative
                            onCommit={(value) => patch({ sillHeight: value })}
                        />
                    ) : (
                        <ReadOnly
                            value={formatLength(size.sillHeight, units)}
                        />
                    )}
                </Row>
                <Row label="Head Height">
                    <LengthField
                        value={size.sillHeight + size.height}
                        units={units}
                        onCommit={(value) =>
                            patch({
                                height: Math.max(
                                    MIN_OPENING_HEIGHT,
                                    value - size.sillHeight,
                                ),
                            })
                        }
                    />
                </Row>
            </Group>

            <Group title="Dimensions">
                <Row label={rowLabel('Width', element.width !== undefined)}>
                    <LengthField
                        value={size.width}
                        units={units}
                        onCommit={setWidth}
                    />
                </Row>
                <Row label={rowLabel('Height', element.height !== undefined)}>
                    <LengthField
                        value={size.height}
                        units={units}
                        onCommit={(value) =>
                            patch({
                                height: Math.max(MIN_OPENING_HEIGHT, value),
                            })
                        }
                    />
                </Row>

                {resized ? (
                    <div className="px-3 pt-1 pb-2">
                        <button
                            type="button"
                            onClick={useTypeSize}
                            className="w-full rounded-sm border border-chrome-border px-2 py-1.5 text-[0.72rem] text-chrome-muted transition-colors hover:bg-chrome-raised hover:text-chrome-fg"
                        >
                            Back to type size ·{' '}
                            {formatLength(fromType.width, units)} ×{' '}
                            {formatLength(fromType.height, units)}
                        </button>
                    </div>
                ) : (
                    <p className="px-3 pt-1 pb-2 text-[0.68rem] text-chrome-muted">
                        Following {typeNameOf(types, element.typeId)}. Type a
                        size here and only this one changes.
                        {Number.isFinite(hostLength) &&
                            ` The wall allows ${formatLength(maxOpeningWidth(hostLength), units)}.`}
                    </p>
                )}
            </Group>

            <Group title="Orientation">
                <div className="flex gap-2 px-3 pb-3">
                    <button
                        type="button"
                        onClick={() => patch({ flipFace: !element.flipFace })}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-sm border border-chrome-border px-2 py-1.5 text-[0.74rem] transition-colors hover:bg-chrome-raised"
                    >
                        <FlipVertical2 className="size-3.5" />
                        Flip Facing
                    </button>
                    {element.kind === 'door' && (
                        <button
                            type="button"
                            onClick={() =>
                                patch({ flipHand: !element.flipHand })
                            }
                            className="flex flex-1 items-center justify-center gap-1.5 rounded-sm border border-chrome-border px-2 py-1.5 text-[0.74rem] transition-colors hover:bg-chrome-raised"
                        >
                            <FlipHorizontal2 className="size-3.5" />
                            Flip Hand
                        </button>
                    )}
                </div>
            </Group>
        </>
    );
}

/**
 * Mark a row whose value has been set on this instance rather than inherited
 * from its type, the way Revit greys type parameters apart from instance ones.
 */
function rowLabel(label: string, overridden: boolean): string {
    return overridden ? `${label} ✎` : label;
}

function typeNameOf(
    types: { id: string; name: string }[],
    typeId: string,
): string {
    return types.find((type) => type.id === typeId)?.name ?? 'its type';
}

function hostLabel(editor: CadEditor, element: OpeningElement): string {
    const host = editor.document.elements.find(
        (item) => item.id === element.host,
    );

    return host?.kind === 'wall'
        ? wallTypeOf(editor.document, host.typeId).name
        : 'Missing host';
}

/* ---------------------------------------------------------------- controls */

function Banner({ title, subtitle }: { title: string; subtitle: string }) {
    return (
        <div className="border-b border-chrome-border bg-chrome-raised px-3 py-2.5">
            <p className="truncate text-[0.82rem] font-medium">{title}</p>
            <p className="truncate text-[0.7rem] text-chrome-muted">
                {subtitle}
            </p>
        </div>
    );
}

function Group({
    title,
    children,
}: {
    title: string;
    children: React.ReactNode;
}) {
    return (
        <div className="border-b border-chrome-border/70">
            <div className="bg-chrome-sunken/60 px-3 py-1 text-[0.66rem] tracking-wider text-chrome-muted uppercase">
                {title}
            </div>
            <div className="py-1">{children}</div>
        </div>
    );
}

function Row({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}) {
    return (
        <div className="grid grid-cols-[1fr_1.2fr] items-center gap-2 px-3 py-1">
            <span className="truncate text-chrome-muted">{label}</span>
            <div className="min-w-0">{children}</div>
        </div>
    );
}

function ReadOnly({ value }: { value: string }) {
    return <div className="truncate py-1 text-right tabular-nums">{value}</div>;
}

function Select({
    value,
    options,
    onChange,
}: {
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
}) {
    return (
        <select
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="w-full rounded-sm border border-chrome-border bg-chrome-sunken px-1.5 py-1 text-[0.75rem] outline-none focus:border-sand"
        >
            {options.map((option) => (
                <option
                    key={option.value}
                    value={option.value}
                    className="bg-chrome-sunken"
                >
                    {option.label}
                </option>
            ))}
        </select>
    );
}

function Toggle({
    value,
    onChange,
}: {
    value: boolean;
    onChange: (value: boolean) => void;
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={value}
            onClick={() => onChange(!value)}
            className={cn(
                'relative h-4 w-8 rounded-full transition-colors',
                value ? 'bg-sand' : 'bg-chrome-border',
            )}
        >
            <span
                className={cn(
                    'absolute top-0.5 size-3 rounded-full bg-chrome-sunken transition-all',
                    value ? 'left-4.5' : 'left-0.5',
                )}
            />
        </button>
    );
}

function TextField({
    value,
    onCommit,
}: {
    value: string;
    onCommit: (value: string) => void;
}) {
    return (
        <input
            key={value}
            defaultValue={value}
            onBlur={(event) => onCommit(event.target.value)}
            onKeyDown={(event) => {
                if (event.key === 'Enter') {
                    event.currentTarget.blur();
                }
            }}
            className="w-full rounded-sm border border-chrome-border bg-chrome-sunken px-1.5 py-1 text-[0.75rem] outline-none focus:border-sand"
        />
    );
}

function LengthField({
    value,
    units,
    allowNegative = false,
    onCommit,
}: {
    value: number;
    units: 'metric' | 'imperial';
    allowNegative?: boolean;
    onCommit: (value: number) => void;
}) {
    return (
        <input
            key={value}
            defaultValue={formatLength(value, units)}
            onBlur={(event) => {
                const parsed = parseLength(event.target.value, units);

                if (parsed !== null && (allowNegative || parsed > 0)) {
                    onCommit(parsed);
                } else {
                    event.target.value = formatLength(value, units);
                }
            }}
            onKeyDown={(event) => {
                if (event.key === 'Enter') {
                    event.currentTarget.blur();
                }
            }}
            className="w-full rounded-sm border border-chrome-border bg-chrome-sunken px-1.5 py-1 text-right text-[0.75rem] tabular-nums outline-none focus:border-sand"
        />
    );
}

function NumberField({
    value,
    min,
    onCommit,
}: {
    value: number;
    min?: number;
    onCommit: (value: number) => void;
}) {
    return (
        <input
            key={value}
            defaultValue={String(value)}
            onBlur={(event) => {
                const parsed = Number.parseFloat(event.target.value);

                if (
                    Number.isFinite(parsed) &&
                    (min === undefined || parsed >= min)
                ) {
                    onCommit(parsed);
                } else {
                    event.target.value = String(value);
                }
            }}
            onKeyDown={(event) => {
                if (event.key === 'Enter') {
                    event.currentTarget.blur();
                }
            }}
            className="w-full rounded-sm border border-chrome-border bg-chrome-sunken px-1.5 py-1 text-right text-[0.75rem] tabular-nums outline-none focus:border-sand"
        />
    );
}
