import { Eraser, PenTool } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { simplifyStroke } from '@/lib/cad/library';
import type { Point } from '@/lib/cad/types';

type SketchPadProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Receives the finished outline in millimetres, already simplified. */
    onAccept: (outline: Point[]) => void;
};

/**
 * How aggressively a stroke is thinned, in pad pixels. Two-ish pixels keeps
 * deliberate corners and drops pen shake.
 */
const SIMPLIFY_EPSILON = 2.5;

/** A stroke shorter than this is a tap, not a shape. */
const POINTS_WORTH_KEEPING = 3;

/**
 * A drawing surface for a finger, an Apple Pencil or a mouse.
 *
 * Pointer events cover all three input kinds with one code path;
 * `touch-action: none` is what stops the page scrolling out from under a
 * finger mid-stroke. The outline is drawn at screen size and rescaled to
 * real millimetres by the width the user declares below the pad.
 */
export function SketchPad({ open, onOpenChange, onAccept }: SketchPadProps) {
    const [stroke, setStroke] = useState<Point[]>([]);
    const [drawing, setDrawing] = useState(false);
    const [widthMm, setWidthMm] = useState(1000);
    const surface = useRef<SVGSVGElement>(null);

    function at(event: React.PointerEvent): Point | null {
        const box = surface.current?.getBoundingClientRect();

        if (!box) {
            return null;
        }

        return {
            x: event.clientX - box.left,
            y: event.clientY - box.top,
        };
    }

    function begin(event: React.PointerEvent) {
        const point = at(event);

        if (!point) {
            return;
        }

        // One outline per sketch — a new stroke starts the shape over.
        surface.current?.setPointerCapture(event.pointerId);
        setStroke([point]);
        setDrawing(true);
    }

    function extend(event: React.PointerEvent) {
        if (!drawing) {
            return;
        }

        const point = at(event);

        if (!point) {
            return;
        }

        setStroke((current) => {
            const last = current[current.length - 1];

            // Ignore sub-2px jitter; it would all be simplified away anyway.
            if (last && Math.hypot(point.x - last.x, point.y - last.y) < 2) {
                return current;
            }

            return [...current, point];
        });
    }

    function finish(event: React.PointerEvent) {
        surface.current?.releasePointerCapture(event.pointerId);
        setDrawing(false);
    }

    const outline = simplifyStroke(stroke, SIMPLIFY_EPSILON);
    const ready = outline.length >= POINTS_WORTH_KEEPING && widthMm > 0;

    function accept() {
        if (!ready) {
            return;
        }

        // Scale pad pixels to real millimetres by the declared width, and
        // flip Y — the pad grows downward, the plan grows northward.
        const xs = outline.map((point) => point.x);
        const drawnWidth = Math.max(1, Math.max(...xs) - Math.min(...xs));
        const scale = widthMm / drawnWidth;

        onAccept(
            outline.map((point) => ({
                x: point.x * scale,
                y: -point.y * scale,
            })),
        );

        setStroke([]);
        onOpenChange(false);
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <PenTool className="size-4 text-sand" />
                        Draw a part
                    </DialogTitle>
                    <DialogDescription>
                        Draw the outline in one stroke — pencil, finger or
                        mouse. It closes itself, then extrudes to the height you
                        give the part.
                    </DialogDescription>
                </DialogHeader>

                <svg
                    ref={surface}
                    role="img"
                    aria-label="Sketch surface"
                    className="h-80 w-full cursor-crosshair touch-none rounded-lg border border-border bg-paper-warm"
                    onPointerDown={begin}
                    onPointerMove={extend}
                    onPointerUp={finish}
                    onPointerCancel={finish}
                >
                    {stroke.length > 1 && (
                        <>
                            <polygon
                                points={stroke
                                    .map((point) => `${point.x},${point.y}`)
                                    .join(' ')}
                                fill="var(--color-sand)"
                                fillOpacity={0.18}
                                stroke="none"
                            />
                            <polyline
                                points={stroke
                                    .map((point) => `${point.x},${point.y}`)
                                    .join(' ')}
                                fill="none"
                                stroke="var(--color-ink)"
                                strokeWidth={2}
                                strokeLinejoin="round"
                                strokeLinecap="round"
                            />
                            {/* The closing edge, sketched in lightly. */}
                            <line
                                x1={stroke[stroke.length - 1].x}
                                y1={stroke[stroke.length - 1].y}
                                x2={stroke[0].x}
                                y2={stroke[0].y}
                                stroke="var(--color-ink)"
                                strokeOpacity={0.35}
                                strokeWidth={2}
                                strokeDasharray="6 5"
                            />
                        </>
                    )}

                    {stroke.length === 0 && (
                        <text
                            x="50%"
                            y="50%"
                            textAnchor="middle"
                            className="fill-muted-foreground text-sm"
                        >
                            Draw here
                        </text>
                    )}
                </svg>

                <DialogFooter className="sm:justify-between">
                    <div className="flex items-end gap-2">
                        <div className="grid gap-1">
                            <Label className="text-[0.62rem] tracking-wide text-muted-foreground uppercase">
                                Widest span, mm
                            </Label>
                            <Input
                                type="number"
                                min={1}
                                value={widthMm}
                                onChange={(event) =>
                                    setWidthMm(Number(event.target.value))
                                }
                                className="h-8 w-28 text-right tabular-nums"
                            />
                        </div>
                        {outline.length >= POINTS_WORTH_KEEPING && (
                            <p className="pb-1.5 text-[0.68rem] text-muted-foreground">
                                {outline.length} corners kept
                            </p>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={stroke.length === 0}
                            onClick={() => setStroke([])}
                        >
                            <Eraser className="size-4" />
                            Clear
                        </Button>
                        <Button
                            type="button"
                            disabled={!ready}
                            onClick={accept}
                        >
                            Use this shape
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
