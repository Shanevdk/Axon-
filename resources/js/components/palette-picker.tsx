import { Check, Palette as PaletteIcon } from 'lucide-react';
import { PALETTES, usePalette } from '@/hooks/use-appearance';
import { cn } from '@/lib/utils';

/**
 * Choose the palette, shown as the three colours a theme actually is:
 * its paper, its quiet accent, and the one loud colour it uses for actions.
 */
export function PalettePicker({ className }: { className?: string }) {
    const { palette, updatePalette } = usePalette();

    return (
        <div className={cn('grid gap-2 sm:grid-cols-2', className)}>
            {PALETTES.map((option) => {
                const chosen = palette === option.value;

                return (
                    <button
                        key={option.value}
                        type="button"
                        onClick={() => updatePalette(option.value)}
                        aria-pressed={chosen}
                        className={cn(
                            'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                            chosen
                                ? 'border-ring bg-accent'
                                : 'border-border hover:border-ring/60 hover:bg-accent/40',
                        )}
                    >
                        <Swatch colours={option.swatch} />

                        <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 text-sm font-medium">
                                {option.label}
                                {chosen && <Check className="size-3.5" />}
                            </span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                                {option.description}
                            </span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

/**
 * A compact version for a page header, where there is no room to explain.
 */
export function PaletteStrip({ className }: { className?: string }) {
    const { palette, updatePalette } = usePalette();

    return (
        <div
            className={cn('flex items-center gap-1.5', className)}
            role="group"
            aria-label="Colour theme"
        >
            <PaletteIcon className="size-3.5 text-ink-muted" aria-hidden />

            {PALETTES.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    title={option.label}
                    aria-label={option.label}
                    aria-pressed={palette === option.value}
                    onClick={() => updatePalette(option.value)}
                    className={cn(
                        'size-5 rounded-full border transition-transform',
                        palette === option.value
                            ? 'scale-110 border-ink'
                            : 'border-ink/20 hover:scale-110',
                    )}
                    style={{
                        background: `linear-gradient(135deg, ${option.swatch[1]} 0 50%, ${option.swatch[2]} 50% 100%)`,
                    }}
                />
            ))}
        </div>
    );
}

function Swatch({ colours }: { colours: [string, string, string] }) {
    return (
        <span className="flex size-9 shrink-0 overflow-hidden rounded-md border border-border">
            {colours.map((colour) => (
                <span
                    key={colour}
                    className="flex-1"
                    style={{ background: colour }}
                />
            ))}
        </span>
    );
}
