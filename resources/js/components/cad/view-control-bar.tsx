import {
    Box,
    Crop,
    Eye,
    EyeOff,
    Frame,
    Grid2x2,
    Group,
    Layers,
    Maximize,
    Minus,
    Palette,
    Plus,
    Sun,
    SunDim,
} from 'lucide-react';
import type { CadEditor } from '@/hooks/use-cad-editor';
import type { DetailLevel, VisualStyle } from '@/lib/cad/types';
import { VIEW_SCALES } from '@/lib/cad/views';
import { cn } from '@/lib/utils';

const DETAIL_LEVELS: { id: DetailLevel; label: string }[] = [
    { id: 'coarse', label: 'Coarse' },
    { id: 'medium', label: 'Medium' },
    { id: 'fine', label: 'Fine' },
];

const VISUAL_STYLES: { id: VisualStyle; label: string }[] = [
    { id: 'wireframe', label: 'Wireframe' },
    { id: 'hiddenLine', label: 'Hidden Line' },
    { id: 'shaded', label: 'Shaded' },
    { id: 'realistic', label: 'Realistic' },
];

/**
 * The strip along the bottom of the drawing area, mirroring Revit's view
 * control bar.
 */
export function ViewControlBar({ editor }: { editor: CadEditor }) {
    const { settings, setViewSetting, activeView } = editor;
    const isModel =
        activeView.kind === 'threeD' || activeView.kind === 'elevation';

    const zoomBy = (factor: number) => {
        if (isModel) {
            editor.setOrbit({
                ...editor.orbit,
                distance: Math.min(
                    Math.max(editor.orbit.distance / factor, 2000),
                    400_000,
                ),
            });

            return;
        }

        editor.setCamera((camera) => ({
            ...camera,
            zoom: Math.min(Math.max(camera.zoom * factor, 0.0008), 2),
        }));
    };

    return (
        <div className="flex h-8 shrink-0 items-center gap-2 border-t border-chrome-border bg-chrome px-2 text-[0.72rem] text-chrome-fg">
            <Dropdown
                icon={<Layers className="size-3.5" />}
                value={`1 : ${settings.scale}`}
                options={VIEW_SCALES.map((scale) => ({
                    value: String(scale),
                    label: `1 : ${scale}`,
                }))}
                onChange={(value) => setViewSetting('scale', Number(value))}
                title="View scale"
            />

            <Dropdown
                icon={<Grid2x2 className="size-3.5" />}
                value={
                    DETAIL_LEVELS.find(
                        (item) => item.id === settings.detailLevel,
                    )?.label ?? ''
                }
                options={DETAIL_LEVELS.map((item) => ({
                    value: item.id,
                    label: item.label,
                }))}
                onChange={(value) =>
                    setViewSetting('detailLevel', value as DetailLevel)
                }
                title="Detail level"
            />

            <Dropdown
                icon={<Box className="size-3.5" />}
                value={
                    VISUAL_STYLES.find(
                        (item) => item.id === settings.visualStyle,
                    )?.label ?? ''
                }
                options={VISUAL_STYLES.map((item) => ({
                    value: item.id,
                    label: item.label,
                }))}
                onChange={(value) =>
                    setViewSetting('visualStyle', value as VisualStyle)
                }
                title="Visual style"
            />

            <IconToggle
                active={settings.shadows}
                onClick={() => setViewSetting('shadows', !settings.shadows)}
                title="Shadows on/off"
            >
                <SunDim className="size-3.5" />
            </IconToggle>

            {isModel && (
                <IconToggle
                    active={settings.naturalMaterials}
                    onClick={() => editor.applyToggle('naturalMaterials')}
                    title="Natural materials — timber, concrete and brick in their own colours (NM)"
                >
                    <Palette className="size-3.5" />
                </IconToggle>
            )}

            {isModel && <ExplodeSlider editor={editor} />}

            <div className="h-4 w-px shrink-0 bg-chrome-border" />

            <IconToggle
                active={settings.cropView}
                onClick={() => setViewSetting('cropView', !settings.cropView)}
                title="Crop view"
            >
                <Crop className="size-3.5" />
            </IconToggle>

            <IconToggle
                active={settings.showCrop}
                onClick={() => setViewSetting('showCrop', !settings.showCrop)}
                title="Show crop region"
            >
                <Frame className="size-3.5" />
            </IconToggle>

            <div className="h-4 w-px shrink-0 bg-chrome-border" />

            <IconToggle
                active={editor.hidden.size > 0}
                onClick={() =>
                    editor.hidden.size > 0
                        ? editor.resetTemporaryHide()
                        : editor.hideSelection()
                }
                title={
                    editor.hidden.size > 0
                        ? `Reset temporary hide (${editor.hidden.size} hidden)`
                        : 'Temporary hide selection (HH)'
                }
            >
                <EyeOff className="size-3.5" />
            </IconToggle>

            <IconToggle
                active={editor.revealHidden}
                onClick={() => editor.setRevealHidden(!editor.revealHidden)}
                title="Reveal hidden elements (RH)"
            >
                <Eye className="size-3.5" />
            </IconToggle>

            <div className="h-4 w-px shrink-0 bg-chrome-border" />

            <IconToggle
                active={settings.showGrid}
                onClick={() => setViewSetting('showGrid', !settings.showGrid)}
                title="Show grid"
            >
                <Grid2x2 className="size-3.5" />
            </IconToggle>

            <IconToggle
                active={settings.showRooms}
                onClick={() => setViewSetting('showRooms', !settings.showRooms)}
                title="Show room fill"
            >
                <Sun className="size-3.5" />
            </IconToggle>

            <div className="ml-auto flex items-center gap-1">
                <IconButton onClick={() => zoomBy(1 / 1.25)} title="Zoom out">
                    <Minus className="size-3.5" />
                </IconButton>
                <span className="w-14 text-center text-chrome-muted tabular-nums">
                    {isModel
                        ? `${Math.round(editor.orbit.distance / 1000)} m`
                        : `${Math.round(editor.camera.zoom * 1000) / 10}×`}
                </span>
                <IconButton onClick={() => zoomBy(1.25)} title="Zoom in">
                    <Plus className="size-3.5" />
                </IconButton>
                <IconButton onClick={editor.zoomFit} title="Zoom to fit (ZF)">
                    <Maximize className="size-3.5" />
                </IconButton>
            </div>
        </div>
    );
}

type DropdownProps = {
    icon: React.ReactNode;
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
    title: string;
};

function Dropdown({ icon, value, options, onChange, title }: DropdownProps) {
    return (
        <label
            title={title}
            className="flex items-center gap-1 rounded-sm border border-transparent px-1 py-0.5 hover:border-chrome-border"
        >
            <span className="text-chrome-muted">{icon}</span>
            <select
                value={
                    options.find((option) => option.label === value)?.value ??
                    options[0]?.value
                }
                onChange={(event) => onChange(event.target.value)}
                className="cursor-pointer bg-transparent text-[0.72rem] outline-none"
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
        </label>
    );
}

function IconToggle({
    active,
    onClick,
    title,
    children,
}: {
    active: boolean;
    onClick: () => void;
    title: string;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={title}
            className={cn(
                'rounded-sm border p-1 transition-colors',
                active
                    ? 'border-sand/50 bg-sand/20 text-sand'
                    : 'border-transparent text-chrome-muted hover:border-chrome-border',
            )}
        >
            {children}
        </button>
    );
}

function IconButton({
    onClick,
    title,
    children,
}: {
    onClick: () => void;
    title: string;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={title}
            className="rounded-sm p-1 text-chrome-muted transition-colors hover:bg-chrome-raised hover:text-chrome-fg"
        >
            {children}
        </button>
    );
}

/**
 * How far the model is pulled apart.
 *
 * With one element selected the slider takes that element apart into its
 * layers; with nothing selected it opens the whole building out. The label
 * says which, because the same control does both.
 */
function ExplodeSlider({ editor }: { editor: CadEditor }) {
    const apart = editor.explodeFactor > 0;
    const what = editor.explodeFocus ? 'this part' : 'the model';

    return (
        <>
            <div className="h-4 w-px shrink-0 bg-chrome-border" />

            <div
                className="flex shrink-0 items-center gap-1.5"
                title={`Explode ${what}`}
            >
                <button
                    type="button"
                    onClick={() => editor.setExplodeFactor(apart ? 0 : 0.55)}
                    className={cn(
                        'flex items-center gap-1 rounded-sm px-1.5 py-0.5 transition-colors',
                        apart
                            ? 'bg-sand/20 text-sand'
                            : 'text-chrome-muted hover:text-chrome-fg',
                    )}
                >
                    <Group className="size-3.5" />
                    Explode
                </button>

                <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={editor.explodeFactor}
                    aria-label={`Explode ${what}`}
                    onChange={(event) =>
                        editor.setExplodeFactor(Number(event.target.value))
                    }
                    className="h-1 w-20 accent-sand"
                />
            </div>
        </>
    );
}
