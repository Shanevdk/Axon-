import { useHttp } from '@inertiajs/react';
import { Compass, Crosshair, MapPin, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
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
import type { CadEditor } from '@/hooks/use-cad-editor';
import { heightRange, levelTerrainTo } from '@/lib/cad/terrain';
import type { Site } from '@/lib/cad/types';
import { formatLength } from '@/lib/cad/units';
import { cn } from '@/lib/utils';
import { ground as groundRoute } from '@/routes/projects/site';

/** How much of the land around the pin to measure, in metres. */
const SPANS = [
    { span: 40, label: '40 m', hint: 'A town lot' },
    { span: 80, label: '80 m', hint: 'A large lot' },
    { span: 160, label: '160 m', hint: 'An acre or so' },
    { span: 400, label: '400 m', hint: 'Rural' },
];

type GroundLevelsDialogProps = {
    editor: CadEditor;
    projectId: number;
    /** Where the project was sited on the map, if it has been. */
    place: { latitude: number | null; longitude: number | null };
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

/**
 * Measure the ground over the property.
 *
 * Two numbers and a size: where the site is, and how much of the land around
 * it to read. What comes back becomes the ground every elevation and section
 * is drawn against, so the dialog is careful to say what it is and — more to
 * the point — what it is not.
 */
export function GroundLevelsDialog({
    editor,
    projectId,
    place,
    open,
    onOpenChange,
}: GroundLevelsDialogProps) {
    const site = editor.document.site ?? null;

    // Ground already measured wins, because it is the middle of the square
    // that was measured. Failing that, the spot picked on the map when the
    // project was sited, so nobody types coordinates they have already given.
    const [latitude, setLatitude] = useState(() =>
        site ? String(site.latitude) : (place?.latitude?.toString() ?? ''),
    );
    const [longitude, setLongitude] = useState(() =>
        site ? String(site.longitude) : (place?.longitude?.toString() ?? ''),
    );
    const [span, setSpan] = useState(80);
    const [trouble, setTrouble] = useState<string | null>(null);
    const [locating, setLocating] = useState(false);

    const { post, transform, processing } = useHttp<
        { latitude: number; longitude: number; span: number },
        { site: Site }
    >({ latitude: 0, longitude: 0, span: 0 });

    /** Ask the browser where we are, and drop the pin there. */
    function locate() {
        if (!navigator.geolocation) {
            setTrouble(
                'This browser cannot share a location. Type the coordinates instead.',
            );

            return;
        }

        setTrouble(null);
        setLocating(true);

        navigator.geolocation.getCurrentPosition(
            (position) => {
                setLatitude(position.coords.latitude.toFixed(6));
                setLongitude(position.coords.longitude.toFixed(6));
                setLocating(false);
            },
            () => {
                setTrouble(
                    'That location was refused. Type the coordinates instead.',
                );
                setLocating(false);
            },
            { enableHighAccuracy: true, timeout: 10_000 },
        );
    }

    function measure() {
        const lat = Number(latitude);
        const lon = Number(longitude);

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            setTrouble('Those coordinates are not a place on earth.');

            return;
        }

        setTrouble(null);
        transform(() => ({ latitude: lat, longitude: lon, span }));

        post(groundRoute.url({ project: projectId }), {
            onSuccess: (response) => {
                editor.store.commit('Measure ground levels', (current) => ({
                    ...current,
                    site: response.site,
                }));

                const fall = response.site.terrain
                    ? heightRange(response.site.terrain)
                    : null;

                editor.setStatus(
                    fall
                        ? `Ground measured — the site falls ${formatLength(
                              fall.max - fall.min,
                              editor.document.units,
                          )}`
                        : 'Ground measured',
                );

                onOpenChange(false);
            },
            onHttpException: (response) => {
                const body = response.data as { message?: string } | null;

                setTrouble(
                    body?.message ??
                        'The ground could not be read for that spot.',
                );

                return false;
            },
            onNetworkError: () => {
                setTrouble('No connection to read the ground levels.');

                return false;
            },
        }).catch(() => {
            // Already reported through the callbacks above.
        });
    }

    /**
     * Put the ground floor back on the ground.
     *
     * After the house has been dragged across a slope its floor is no longer
     * at ground level, which is often exactly what you want to see. This is
     * the way back: the survey shifts so the middle of the house sits at zero
     * again, and the shape of the land is untouched.
     */
    function levelToBuilding() {
        const terrain = editor.document.site?.terrain;

        if (!terrain) {
            return;
        }

        editor.store.commit('Level the ground floor', (current) =>
            current.site?.terrain
                ? {
                      ...current,
                      site: {
                          ...current.site,
                          terrain: levelTerrainTo(
                              current.site.terrain,
                              { x: 0, y: 0 },
                              0,
                          ),
                      },
                  }
                : current,
        );

        editor.setStatus('Ground floor levelled to the ground');
        onOpenChange(false);
    }

    const measured = site?.terrain ?? null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Compass className="size-4 text-sand" />
                        Ground Levels
                    </DialogTitle>
                    <DialogDescription>
                        Read the height of the land over this property. The
                        ground appears in the Site view, and under the building
                        in every elevation, section and 3D view.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label htmlFor="site-latitude">Latitude</Label>
                            <Input
                                id="site-latitude"
                                value={latitude}
                                inputMode="decimal"
                                placeholder="49.2827"
                                onChange={(event) =>
                                    setLatitude(event.target.value)
                                }
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="site-longitude">Longitude</Label>
                            <Input
                                id="site-longitude"
                                value={longitude}
                                inputMode="decimal"
                                placeholder="-123.1207"
                                onChange={(event) =>
                                    setLongitude(event.target.value)
                                }
                            />
                        </div>
                    </div>

                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={locate}
                        disabled={locating || processing}
                    >
                        <Crosshair className="size-4" />
                        {locating ? 'Finding you…' : 'Use my location'}
                    </Button>

                    <div className="space-y-1.5">
                        <Label>How much land to measure</Label>
                        <div className="grid grid-cols-4 gap-2">
                            {SPANS.map((choice) => (
                                <button
                                    key={choice.span}
                                    type="button"
                                    onClick={() => setSpan(choice.span)}
                                    className={cn(
                                        'rounded-lg border px-2 py-2 text-center text-xs transition',
                                        span === choice.span
                                            ? 'border-sand bg-sand/15 text-foreground'
                                            : 'border-border text-muted-foreground hover:border-sand/60',
                                    )}
                                >
                                    <span className="block font-medium">
                                        {choice.label}
                                    </span>
                                    <span className="block text-[11px] opacity-70">
                                        {choice.hint}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {measured && (
                        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
                            <p className="flex items-center gap-1.5 font-medium text-foreground">
                                <MapPin className="size-3.5" />
                                Already measured
                            </p>
                            <p className="mt-1">
                                {site?.latitude}, {site?.longitude} — falls{' '}
                                {formatLength(
                                    heightRange(measured).max -
                                        heightRange(measured).min,
                                    editor.document.units,
                                )}{' '}
                                across the property.
                            </p>
                            <button
                                type="button"
                                onClick={levelToBuilding}
                                className="mt-2 text-sand underline-offset-2 hover:underline"
                            >
                                Put the ground floor back on the ground
                            </button>
                        </div>
                    )}

                    <p className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs text-muted-foreground">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                        <span>
                            These levels come from a 30-metre terrain model, so
                            they are the shape of the land and not a survey.
                            Good enough to site a house and to draw ground on an
                            elevation. Never good enough to set a footing.
                        </span>
                    </p>

                    {trouble && (
                        <p className="text-sm text-destructive">{trouble}</p>
                    )}
                </div>

                <DialogFooter>
                    <Button
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        disabled={processing}
                    >
                        Cancel
                    </Button>
                    <Button onClick={measure} disabled={processing}>
                        {processing ? 'Measuring…' : 'Measure the ground'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
