import { useHttp, usePage } from '@inertiajs/react';
import { Crosshair, Loader2, MapPin, Minus, Plus, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    clamp,
    formatPlace,
    MAX_ZOOM,
    MIN_ZOOM,
    panBy,
    pointAt,
    project,
    roundPlace,
    tileGrid,
    tileUrl,
} from '@/lib/map';
import type { LatLng } from '@/lib/map';
import { cn } from '@/lib/utils';
import { places as placesRoute } from '@/routes/site';

/** Long enough that a typed address is not searched letter by letter. */
const SETTLE = 600;

/** Close enough to read house numbers off the map. */
const PICKED_ZOOM = 18;

/** Where the map opens before anything is chosen: most of a continent. */
const OPENING = { latitude: 49.2827, longitude: -123.1207 };
const OPENING_ZOOM = 10;

type Place = {
    label: string;
    latitude: number;
    longitude: number;
    region: string | null;
};

export type SiteSelection = {
    address: string;
    latitude: number | null;
    longitude: number | null;
    /** City, province, country — what decides which code is in force. */
    region: string | null;
};

type SitePickerProps = {
    value: SiteSelection;
    onChange: (next: SiteSelection) => void;
    error?: string;
    className?: string;
};

type MapConfig = {
    map: { tiles: string; attribution: string };
};

/**
 * Choose where a building stands.
 *
 * Two ways in, because neither is enough on its own: search for the address,
 * then move the pin to the spot. A geocoder puts you on the right lot and
 * not much better than that, and the person siting the house usually knows
 * exactly which corner of it they mean.
 */
export function SitePicker({
    value,
    onChange,
    error,
    className,
}: SitePickerProps) {
    const { map } = usePage<MapConfig>().props;

    const pin: LatLng | null =
        value.latitude === null || value.longitude === null
            ? null
            : { latitude: value.latitude, longitude: value.longitude };

    const [centre, setCentre] = useState<LatLng>(pin ?? OPENING);
    const [zoom, setZoom] = useState(pin ? PICKED_ZOOM : OPENING_ZOOM);
    const [results, setResults] = useState<Place[] | null>(null);
    const [searched, setSearched] = useState(value.address);

    const { get, processing } = useHttp<
        { q: string },
        { places: Place[] }
    >({ q: '' });

    // Search after a pause in typing rather than on every keystroke: the
    // service behind this asks for no more than a request a second.
    useEffect(() => {
        const query = value.address.trim();

        if (query.length < 3 || query === searched) {
            return;
        }

        const timer = window.setTimeout(() => {
            setSearched(query);

            get(placesRoute.url({ query: { q: query } }), {
                onSuccess: (response: { places: Place[] }) => {
                    setResults(response.places);
                },
                onError: () => setResults([]),
            });
        }, SETTLE);

        return () => window.clearTimeout(timer);
    }, [get, searched, value.address]);

    const choose = (place: Place) => {
        const rounded = roundPlace(place);

        setCentre(rounded);
        setZoom(PICKED_ZOOM);
        setResults(null);
        setSearched(place.label);

        onChange({
            address: place.label,
            latitude: rounded.latitude,
            longitude: rounded.longitude,
            region: place.region,
        });
    };

    const movePin = (place: LatLng) => {
        const rounded = roundPlace(clamp(place));

        onChange({
            ...value,
            latitude: rounded.latitude,
            longitude: rounded.longitude,
        });
    };

    return (
        <div className={cn('space-y-2', className)}>
            <div className="grid gap-1.5">
                <Label
                    htmlFor="site-address"
                    className="text-xs tracking-wide text-muted-foreground uppercase"
                >
                    Site address
                </Label>

                <div className="relative">
                    <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        id="site-address"
                        name="address"
                        value={value.address}
                        autoComplete="off"
                        placeholder="Search for an address, or drop a pin below"
                        className="pl-9"
                        onChange={(event) =>
                            onChange({ ...value, address: event.target.value })
                        }
                    />
                    {processing && (
                        <Loader2 className="absolute top-1/2 right-3 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
                    )}
                </div>

                {error && <p className="text-xs text-destructive">{error}</p>}
            </div>

            {results !== null && (
                <div className="overflow-hidden rounded-md border border-border">
                    {results.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-muted-foreground">
                            Nothing found for that. Try a wider search, or drop
                            the pin on the map yourself.
                        </p>
                    ) : (
                        <ul className="divide-y divide-border">
                            {results.map((place) => (
                                <li key={`${place.latitude},${place.longitude}`}>
                                    <button
                                        type="button"
                                        onClick={() => choose(place)}
                                        className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent"
                                    >
                                        <MapPin className="mt-0.5 size-3.5 shrink-0 text-sand" />
                                        <span>{place.label}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            <TileMap
                tiles={map.tiles}
                attribution={map.attribution}
                centre={centre}
                zoom={zoom}
                pin={pin}
                onCentre={setCentre}
                onZoom={setZoom}
                onPick={movePin}
            />

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {pin ? (
                    <>
                        <MapPin className="size-3.5 text-sand" />
                        <span className="tabular-nums">{formatPlace(pin)}</span>
                        <button
                            type="button"
                            className="ml-auto flex items-center gap-1 transition-colors hover:text-foreground"
                            onClick={() =>
                                onChange({
                                    ...value,
                                    latitude: null,
                                    longitude: null,
                                })
                            }
                        >
                            <X className="size-3" />
                            Clear the pin
                        </button>
                    </>
                ) : (
                    <>
                        <Crosshair className="size-3.5" />
                        <span>
                            No spot chosen — click the map to put the building
                            somewhere.
                        </span>
                    </>
                )}
            </div>

            <input
                type="hidden"
                name="latitude"
                value={value.latitude ?? ''}
            />
            <input
                type="hidden"
                name="longitude"
                value={value.longitude ?? ''}
            />
        </div>
    );
}

/* ------------------------------------------------------------------- map */

function TileMap({
    tiles,
    attribution,
    centre,
    zoom,
    pin,
    onCentre,
    onZoom,
    onPick,
}: {
    tiles: string;
    attribution: string;
    centre: LatLng;
    zoom: number;
    pin: LatLng | null;
    onCentre: (next: LatLng) => void;
    onZoom: (next: number) => void;
    onPick: (place: LatLng) => void;
}) {
    const frameRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });

    // A drag both pans the map and suppresses the click that ends it, so
    // panning does not also move the pin.
    const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

    useEffect(() => {
        const frame = frameRef.current;

        if (!frame) {
            return;
        }

        const observer = new ResizeObserver(([entry]) => {
            setSize({
                width: Math.floor(entry.contentRect.width),
                height: Math.floor(entry.contentRect.height),
            });
        });

        observer.observe(frame);

        return () => observer.disconnect();
    }, []);

    const grid =
        size.width > 0 ? tileGrid(centre, zoom, size.width, size.height) : [];

    // Where the pin sits relative to the middle of the frame.
    const pinAt = (() => {
        if (!pin || size.width === 0) {
            return null;
        }

        const from = project(centre, zoom);
        const to = project(pin, zoom);

        return {
            left: size.width / 2 + (to.x - from.x),
            top: size.height / 2 + (to.y - from.y),
        };
    })();

    return (
        <div className="overflow-hidden rounded-md border border-border">
            <div
                ref={frameRef}
                className="relative h-56 cursor-grab touch-none bg-paper-warm select-none active:cursor-grabbing"
                onPointerDown={(event) => {
                    drag.current = {
                        x: event.clientX,
                        y: event.clientY,
                        moved: false,
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                    const from = drag.current;

                    if (!from) {
                        return;
                    }

                    const dx = event.clientX - from.x;
                    const dy = event.clientY - from.y;

                    if (Math.abs(dx) + Math.abs(dy) < 3) {
                        return;
                    }

                    drag.current = {
                        x: event.clientX,
                        y: event.clientY,
                        moved: true,
                    };

                    onCentre(panBy(centre, zoom, dx, dy));
                }}
                onPointerUp={(event) => {
                    const from = drag.current;
                    drag.current = null;
                    event.currentTarget.releasePointerCapture?.(event.pointerId);

                    if (from?.moved) {
                        return;
                    }

                    const box = event.currentTarget.getBoundingClientRect();

                    onPick(
                        pointAt(
                            centre,
                            zoom,
                            event.clientX - box.left - box.width / 2,
                            event.clientY - box.top - box.height / 2,
                        ),
                    );
                }}
                onPointerCancel={() => {
                    drag.current = null;
                }}
                onWheel={(event) => {
                    onZoom(
                        Math.min(
                            Math.max(
                                zoom + (event.deltaY < 0 ? 1 : -1),
                                MIN_ZOOM,
                            ),
                            MAX_ZOOM,
                        ),
                    );
                }}
            >
                {grid.map((tile) => (
                    <img
                        key={tile.key}
                        src={tileUrl(tiles, tile)}
                        alt=""
                        draggable={false}
                        loading="lazy"
                        className="pointer-events-none absolute size-64 max-w-none"
                        style={{ left: tile.left, top: tile.top }}
                    />
                ))}

                {pinAt && (
                    <MapPin
                        className="pointer-events-none absolute size-7 fill-sand text-ink drop-shadow"
                        style={{
                            left: pinAt.left,
                            top: pinAt.top,
                            // The point of the pin is its bottom tip.
                            transform: 'translate(-50%, -100%)',
                        }}
                    />
                )}

                <div className="absolute top-2 right-2 flex flex-col gap-1">
                    <ZoomButton
                        label="Zoom in"
                        onClick={() => onZoom(Math.min(zoom + 1, MAX_ZOOM))}
                    >
                        <Plus className="size-3.5" />
                    </ZoomButton>
                    <ZoomButton
                        label="Zoom out"
                        onClick={() => onZoom(Math.max(zoom - 1, MIN_ZOOM))}
                    >
                        <Minus className="size-3.5" />
                    </ZoomButton>
                </div>

                <p className="absolute right-0 bottom-0 bg-background/80 px-1.5 py-0.5 text-[0.6rem] text-muted-foreground">
                    {attribution}
                </p>
            </div>
        </div>
    );
}

function ZoomButton({
    label,
    onClick,
    children,
}: {
    label: string;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <Button
            type="button"
            variant="secondary"
            size="icon"
            className="size-7"
            aria-label={label}
            onClick={onClick}
        >
            {children}
        </Button>
    );
}

