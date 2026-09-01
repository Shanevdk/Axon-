<?php

namespace App\Actions\Assistant;

use App\Models\Project;
use Illuminate\Support\Facades\Cache;

/**
 * A workbench the browser can lend its drawing to.
 *
 * Drawings live on the machine that drew them. The server keeps a preview and
 * nothing more, which is why the MCP tools refuse to edit a project whose
 * model is away — an edit there would look like it worked and then be
 * overwritten by the next save.
 *
 * The sidebar gets around that honestly: for the length of one turn the
 * browser puts the whole live document on this bench, Claude works it through
 * the ordinary MCP tools, and the browser takes the result back into its own
 * vault as a single undoable change. Nothing is written to `projects`, so the
 * preview and the client's copy of the house are never disturbed, and the
 * bench expires on its own if a turn dies half way through.
 *
 * The bench must be readable from another process: the MCP server runs as its
 * own `php artisan mcp:start cad`, spawned by the CLI. That means the cache
 * store has to be a shared one — database, file or redis, never `array`.
 */
class ModelBench
{
    /**
     * How long a lent drawing survives without being collected.
     *
     * Long enough for a slow multi-turn build, short enough that a crashed
     * turn cannot leave a stale model lying about for the next one.
     */
    public const MINUTES = 15;

    /**
     * The largest drawing worth handing over, in bytes of JSON.
     *
     * A model carrying imported meshes runs to tens of thousands of vertices
     * per element. Past this it is quicker to say so than to spend a minute
     * moving it twice.
     */
    public const MAX_BYTES = 8 * 1024 * 1024;

    /**
     * Put a drawing on the bench.
     *
     * @param  array<string, mixed>  $document
     */
    public function lend(Project $project, array $document): void
    {
        Cache::put(
            self::keyFor($project->id),
            $document,
            now()->addMinutes(self::MINUTES),
        );
    }

    /**
     * The drawing currently on the bench for this project, if any.
     *
     * @return array<string, mixed>|null
     */
    public function borrowed(int $projectId): ?array
    {
        $held = Cache::get(self::keyFor($projectId));

        return is_array($held) ? $held : null;
    }

    /**
     * Whether anything is on the bench for this project.
     */
    public function isOpen(int $projectId): bool
    {
        return $this->borrowed($projectId) !== null;
    }

    /**
     * Leave the drawing as the tools left it.
     *
     * @param  array<string, mixed>  $document
     */
    public function put(int $projectId, array $document): void
    {
        Cache::put(
            self::keyFor($projectId),
            $document,
            now()->addMinutes(self::MINUTES),
        );
    }

    /**
     * Take the drawing back and clear the bench.
     *
     * @return array<string, mixed>|null
     */
    public function collect(int $projectId): ?array
    {
        $held = $this->borrowed($projectId);

        Cache::forget(self::keyFor($projectId));

        return $held;
    }

    /**
     * Whether a document is small enough to hand over at all.
     *
     * @param  array<string, mixed>  $document
     */
    public function fits(array $document): bool
    {
        return strlen((string) json_encode($document)) <= self::MAX_BYTES;
    }

    private static function keyFor(int $projectId): string
    {
        return 'model-bench:'.$projectId;
    }
}
