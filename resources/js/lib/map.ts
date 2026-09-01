/**
 * Just enough of a slippy map to put a pin on a house.
 *
 * Raster tiles laid out in Web Mercator, the projection every tile server
 * speaks. There is no map library behind this: a picker needs to pan, zoom
 * and hand back a coordinate, and that is four functions of arithmetic.
 *
 * Everything here works in "world pixels" — the whole earth as one square
 * of 256 × 2^zoom pixels, with the origin at the north-west corner. Tiles
 * are that square cut into 256s, so a world pixel divided by 256 is a tile.
 */

export type LatLng = { latitude: number; longitude: number };

export const TILE_SIZE = 256;

/** Below this the whole world is smaller than the picker. */
export const MIN_ZOOM = 3;

/** Past this most tile servers have nothing left to show. */
export const MAX_ZOOM = 19;

/**
 * Mercator runs to infinity at the poles, so the projection is cut off at
 * the latitude that makes the world square. This is the usual one.
 */
const MAX_LATITUDE = 85.05112878;

/** Where a coordinate falls in world pixels at this zoom. */
export function project(place: LatLng, zoom: number): { x: number; y: number } {
    const scale = TILE_SIZE * 2 ** zoom;
    const latitude = Math.max(
        Math.min(place.latitude, MAX_LATITUDE),
        -MAX_LATITUDE,
    );
    const sin = Math.sin((latitude * Math.PI) / 180);

    return {
        x: ((place.longitude + 180) / 360) * scale,
        y:
            (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) *
            scale,
    };
}

/** The coordinate at a point in world pixels — the inverse of `project`. */
export function unproject(
    x: number,
    y: number,
    zoom: number,
): LatLng {
    const scale = TILE_SIZE * 2 ** zoom;

    return {
        longitude: (x / scale) * 360 - 180,
        latitude:
            (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / scale))) * 180) /
            Math.PI,
    };
}

/**
 * Move a coordinate by a distance on screen — what a drag of the map means.
 *
 * Dragging right moves the map east under the pin, so the coordinate goes
 * west; the signs here are the pixels being subtracted for that reason.
 */
export function panBy(
    centre: LatLng,
    zoom: number,
    dx: number,
    dy: number,
): LatLng {
    const point = project(centre, zoom);

    return clamp(unproject(point.x - dx, point.y - dy, zoom));
}

/** The coordinate under a point in the viewport, measured from its centre. */
export function pointAt(
    centre: LatLng,
    zoom: number,
    offsetX: number,
    offsetY: number,
): LatLng {
    const point = project(centre, zoom);

    return clamp(unproject(point.x + offsetX, point.y + offsetY, zoom));
}

export type Tile = {
    /** Tile coordinates, as the URL template wants them. */
    x: number;
    y: number;
    z: number;
    /** Where to put it in the viewport, in CSS pixels from the top left. */
    left: number;
    top: number;
    /** Stable across pans, so React reuses the image rather than reloading it. */
    key: string;
};

/**
 * Every tile needed to cover a viewport, with its position on screen.
 *
 * Tiles off the east or west edge of the world are wrapped, so panning
 * across the date line shows map rather than a gap. Off the top or bottom
 * there is nothing to wrap to, and those are dropped.
 */
export function tileGrid(
    centre: LatLng,
    zoom: number,
    width: number,
    height: number,
): Tile[] {
    const point = project(centre, zoom);
    const span = 2 ** zoom;

    // World pixel at the top left corner of the viewport.
    const originX = point.x - width / 2;
    const originY = point.y - height / 2;

    const firstColumn = Math.floor(originX / TILE_SIZE);
    const firstRow = Math.floor(originY / TILE_SIZE);
    const lastColumn = Math.floor((originX + width) / TILE_SIZE);
    const lastRow = Math.floor((originY + height) / TILE_SIZE);

    const tiles: Tile[] = [];

    for (let row = firstRow; row <= lastRow; row++) {
        if (row < 0 || row >= span) {
            continue;
        }

        for (let column = firstColumn; column <= lastColumn; column++) {
            // `%` keeps the sign of the dividend in JavaScript, so a tile
            // west of the prime meridian needs the extra turn.
            const wrapped = ((column % span) + span) % span;

            tiles.push({
                x: wrapped,
                y: row,
                z: zoom,
                left: column * TILE_SIZE - originX,
                top: row * TILE_SIZE - originY,
                key: `${zoom}/${column}/${row}`,
            });
        }
    }

    return tiles;
}

/** Fill a `{z}/{x}/{y}` template. */
export function tileUrl(template: string, tile: Tile): string {
    return template
        .replace('{z}', String(tile.z))
        .replace('{x}', String(tile.x))
        .replace('{y}', String(tile.y));
}

/** Hold a coordinate inside the world the projection can draw. */
export function clamp(place: LatLng): LatLng {
    return {
        latitude: Math.max(
            Math.min(place.latitude, MAX_LATITUDE),
            -MAX_LATITUDE,
        ),
        longitude: ((((place.longitude + 180) % 360) + 360) % 360) - 180,
    };
}

/** Six decimals is a tenth of a metre, and further is false precision. */
export function roundPlace(place: LatLng): LatLng {
    return {
        latitude: Math.round(place.latitude * 1e6) / 1e6,
        longitude: Math.round(place.longitude * 1e6) / 1e6,
    };
}

/** How a coordinate is written on screen. */
export function formatPlace(place: LatLng): string {
    const face = (value: number, positive: string, negative: string): string =>
        `${Math.abs(value).toFixed(5)}° ${value >= 0 ? positive : negative}`;

    return `${face(place.latitude, 'N', 'S')}, ${face(place.longitude, 'E', 'W')}`;
}
