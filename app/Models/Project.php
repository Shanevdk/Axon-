<?php

namespace App\Models;

use App\Actions\Projects\BuildStarterDocument;
use Database\Factories\ProjectFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;
use stdClass;

/**
 * @property int $id
 * @property int $user_id
 * @property int|null $client_id
 * @property string $name
 * @property string|null $number
 * @property string|null $client
 * @property string|null $address
 * @property string|null $jurisdiction
 * @property float|null $latitude
 * @property float|null $longitude
 * @property string $units
 * @property array<string, mixed> $document
 * @property array<string, mixed>|null $client_model
 * @property bool $has_local_model
 * @property array<string, mixed>|null $summary
 * @property Carbon|null $opened_at
 * @property int $worked_seconds
 * @property Carbon|null $worked_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['name', 'number', 'client', 'address', 'jurisdiction', 'latitude', 'longitude', 'units', 'document'])]
class Project extends Model
{
    /** @use HasFactory<ProjectFactory> */
    use HasFactory;

    /**
     * A pause in save activity longer than this ends the working session, so
     * leaving the editor open overnight does not count as a night's work.
     */
    public const IDLE_THRESHOLD_SECONDS = 600;

    /**
     * The user who owns the project.
     *
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * The client this drawing is assigned to.
     *
     * @return BelongsTo<Client, $this>
     */
    public function clientRecord(): BelongsTo
    {
        return $this->belongsTo(Client::class, 'client_id');
    }

    /**
     * The house as the client portal shows it, normalized and ready to build
     * solids from.
     *
     * Prefers the published client model, which carries every level. Falls
     * back to the stored document for projects that predate it or whose model
     * still lives on the server — which, once the model has moved onto
     * somebody's machine, is only the thumbnail's one level.
     *
     * @return array<string, mixed>|null
     */
    public function houseModel(): ?array
    {
        $model = $this->client_model ?? $this->document;

        if (($model['elements'] ?? []) === []) {
            return null;
        }

        return app(BuildStarterDocument::class)->normalize($model);
    }

    /**
     * Whether the portal is showing the whole house or only the one level
     * the thumbnail kept, so the client can be told which they are walking.
     */
    public function houseModelIsWholeBuilding(): bool
    {
        return $this->client_model !== null || ! $this->has_local_model;
    }

    /**
     * What the client has said about this drawing from the portal.
     *
     * @return HasMany<ClientComment, $this>
     */
    public function comments(): HasMany
    {
        return $this->hasMany(ClientComment::class);
    }

    /**
     * Accumulate active editing time from save activity.
     *
     * Called whenever the model is opened or saved. Time between two events
     * within the idle threshold counts as work; a longer gap starts a new
     * session and contributes nothing. No timer to start or stop — the record
     * of work is the work itself.
     */
    public function recordWork(): void
    {
        $now = now();

        $updates = ['worked_at' => $now];

        if ($this->worked_at !== null) {
            $gap = (int) round(abs($now->floatDiffInSeconds($this->worked_at)));

            if ($gap > 0 && $gap <= self::IDLE_THRESHOLD_SECONDS) {
                $updates['worked_seconds'] = $this->worked_seconds + $gap;
            }
        }

        $this->forceFill($updates)->saveQuietly();
    }

    /**
     * Summarise the model document for listing screens.
     *
     * Lengths are millimetres and areas square millimetres, matching the way
     * the document itself stores them.
     *
     * @return array{levels: int, walls: int, rooms: int, openings: int, wallLength: float, slabArea: float}
     */
    public function documentSummary(): array
    {
        // Once the model lives on someone's machine the stored document is
        // only a preview of one level, so counting it would undercount the
        // project. The editor sends the real figures instead.
        if ($this->summary !== null) {
            return [
                'levels' => (int) ($this->summary['levels'] ?? 0),
                'walls' => (int) ($this->summary['walls'] ?? 0),
                'rooms' => (int) ($this->summary['rooms'] ?? 0),
                'openings' => (int) ($this->summary['openings'] ?? 0),
                'wallLength' => (float) ($this->summary['wallLength'] ?? 0),
                'slabArea' => (float) ($this->summary['slabArea'] ?? 0),
            ];
        }

        $elements = $this->elements();

        $countOf = fn (string ...$kinds): int => count(array_filter(
            $elements,
            fn (array $element): bool => in_array($element['kind'] ?? '', $kinds, true),
        ));

        return [
            'levels' => count($this->document['levels'] ?? []),
            'walls' => $countOf('wall'),
            'rooms' => $countOf('room'),
            'openings' => $countOf('door', 'window'),
            'wallLength' => $this->totalWallLength(),
            'slabArea' => $this->totalSlabArea(),
        ];
    }

    /**
     * Total centre line length of every wall in the model, in millimetres.
     */
    public function totalWallLength(): float
    {
        return array_sum(array_map(
            fn (array $wall): float => $this->segmentLength($wall),
            $this->elementsOfKind('wall'),
        ));
    }

    /**
     * Combined footprint of every floor slab, in square millimetres.
     */
    public function totalSlabArea(): float
    {
        return array_sum(array_map(
            fn (array $floor): float => $this->polygonArea($floor['points'] ?? []),
            $this->elementsOfKind('floor'),
        ));
    }

    /**
     * Length of wall built from each wall type, keyed by type id.
     *
     * @return array<string, array{name: string, length: float}>
     */
    public function wallLengthByType(): array
    {
        $names = [];

        foreach ($this->document['wallTypes'] ?? [] as $type) {
            $names[$type['id']] = $type['name'];
        }

        $totals = [];

        foreach ($this->elementsOfKind('wall') as $wall) {
            $typeId = $wall['typeId'] ?? 'unknown';

            $totals[$typeId] ??= ['name' => $names[$typeId] ?? 'Unknown type', 'length' => 0.0];
            $totals[$typeId]['length'] += $this->segmentLength($wall);
        }

        return $totals;
    }

    /**
     * A trimmed document holding just the busiest level, enough for the
     * browser to draw a plan thumbnail without shipping the whole model.
     *
     * @return array<string, mixed>|null
     */
    public function planPreview(): ?array
    {
        // Already a preview — the editor trimmed it before sending it up.
        if ($this->has_local_model) {
            return ($this->document['elements'] ?? []) === [] ? null : $this->document;
        }

        $level = $this->busiestLevel();

        if ($level === null) {
            return null;
        }

        $drawable = ['wall', 'door', 'window', 'floor', 'room', 'mesh'];

        $elements = array_values(array_map(
            // A mesh can carry tens of thousands of triangle vertices; the
            // thumbnail only draws its footprint, so the triangles stay home.
            fn (array $element): array => ($element['kind'] ?? '') === 'mesh'
                ? [...$element, 'vertices' => []]
                : $element,
            array_filter(
                $this->elements(),
                fn (array $element): bool => in_array($element['kind'] ?? '', $drawable, true)
                    && ($element['level'] ?? null) === $level['id'],
            ),
        ));

        if ($elements === []) {
            return null;
        }

        return [
            'version' => $this->document['version'] ?? 1,
            'units' => $this->units,
            'levels' => [$level],
            'wallTypes' => $this->document['wallTypes'] ?? [],
            'doorTypes' => $this->document['doorTypes'] ?? [],
            'windowTypes' => $this->document['windowTypes'] ?? [],
            'elements' => $elements,
            'viewSettings' => new stdClass,
        ];
    }

    /**
     * The level carrying the most walls, which is the one worth previewing.
     *
     * @return array<string, mixed>|null
     */
    private function busiestLevel(): ?array
    {
        $levels = $this->document['levels'] ?? [];

        if ($levels === []) {
            return null;
        }

        $walls = $this->elementsOfKind('wall');

        $counts = array_map(
            fn (array $level): int => count(array_filter(
                $walls,
                fn (array $wall): bool => ($wall['level'] ?? null) === $level['id'],
            )),
            $levels,
        );

        $best = array_search(max($counts), $counts, true);

        return $levels[$best === false ? 0 : $best];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function elements(): array
    {
        return $this->document['elements'] ?? [];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function elementsOfKind(string $kind): array
    {
        return array_filter(
            $this->elements(),
            fn (array $element): bool => ($element['kind'] ?? '') === $kind,
        );
    }

    /**
     * @param  array<string, mixed>  $element
     */
    private function segmentLength(array $element): float
    {
        $a = $element['a'] ?? ['x' => 0, 'y' => 0];
        $b = $element['b'] ?? ['x' => 0, 'y' => 0];

        return hypot($b['x'] - $a['x'], $b['y'] - $a['y']);
    }

    /**
     * Shoelace area of a closed polygon.
     *
     * @param  array<int, array{x: float|int, y: float|int}>  $points
     */
    private function polygonArea(array $points): float
    {
        $count = count($points);

        if ($count < 3) {
            return 0.0;
        }

        $total = 0.0;

        for ($index = 0; $index < $count; $index++) {
            $current = $points[$index];
            $next = $points[($index + 1) % $count];
            $total += $current['x'] * $next['y'] - $next['x'] * $current['y'];
        }

        return abs($total) / 2;
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'document' => 'array',
            'client_model' => 'array',
            'latitude' => 'float',
            'longitude' => 'float',
            'summary' => 'array',
            'has_local_model' => 'boolean',
            'opened_at' => 'datetime',
            'worked_at' => 'datetime',
            'worked_seconds' => 'integer',
        ];
    }
}
