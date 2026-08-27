<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * The item designer's parts board, shared live with Claude Code.
 *
 * Both sides write it: the browser publishes what is on screen, Claude Code
 * reads that and writes back a revised board over MCP. `revision` and
 * `source` are how each side tells its own change from the other's, so
 * neither echoes the other in a loop.
 *
 * @property int $id
 * @property int $user_id
 * @property array<int, array<string, mixed>> $parts
 * @property string|null $name
 * @property string|null $category
 * @property int $revision
 * @property string $source
 * @property string|null $note
 * @property string|null $message
 * @property Carbon|null $opened_at
 * @property Carbon|null $claimed_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['parts', 'name', 'category', 'note', 'message'])]
class DesignBoard extends Model
{
    /**
     * How long a browser counts as sitting at the board. Past this, Claude
     * Code is told nobody is watching.
     */
    public const AT_THE_BOARD_MINUTES = 10;

    /**
     * Whoever is designing.
     *
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Write a new board, saying who wrote it.
     *
     * @param  array<int, array<string, mixed>>  $parts
     */
    public function publish(array $parts, string $source, array $extra = []): void
    {
        $this->forceFill([
            ...$extra,
            'parts' => $parts,
            'source' => $source,
            'revision' => $this->revision + 1,
        ])->save();
    }

    /**
     * Whether somebody has the designer open and is watching.
     */
    public function isBeingWatched(): bool
    {
        return $this->opened_at !== null
            && $this->opened_at->gt(now()->subMinutes(self::AT_THE_BOARD_MINUTES));
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'parts' => 'array',
            'opened_at' => 'datetime',
            'claimed_at' => 'datetime',
        ];
    }
}
