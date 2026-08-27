<?php

namespace App\Models;

use Database\Factories\NoteFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * @property int $id
 * @property int $user_id
 * @property int|null $project_id
 * @property string $title
 * @property string|null $body
 * @property bool $pinned
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['title', 'body', 'pinned', 'project_id'])]
class Note extends Model
{
    /** @use HasFactory<NoteFactory> */
    use HasFactory;

    /**
     * How much of the body the listing shows before it is cut short.
     */
    public const EXCERPT_LENGTH = 240;

    /**
     * The person who wrote the note.
     *
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * The drawing this note was pinned to, if it was about one.
     *
     * @return BelongsTo<Project, $this>
     */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /**
     * Reading order for the notebook: pinned notes first, then whatever was
     * touched most recently.
     *
     * @param  Builder<Note>  $query
     * @return Builder<Note>
     */
    public function scopeInReadingOrder(Builder $query): Builder
    {
        return $query->orderByDesc('pinned')->latest('updated_at')->latest('id');
    }

    /**
     * The opening of the body, for the card in the listing.
     */
    public function excerpt(): string
    {
        return Str::limit((string) $this->body, self::EXCERPT_LENGTH);
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'pinned' => 'boolean',
        ];
    }
}
