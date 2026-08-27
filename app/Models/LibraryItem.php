<?php

namespace App\Models;

use Database\Factories\LibraryItemFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A reusable item in the studio's model library.
 *
 * `imported` items came in as OBJ/STL files and carry geometry only;
 * `designed` items were built part by part in the designer and keep their
 * part list, which is what makes them editable again later.
 *
 * @property int $id
 * @property int $user_id
 * @property string $name
 * @property string $category
 * @property string $kind
 * @property string $thumbnail
 * @property array<string, mixed> $payload
 * @property int $triangles
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['name', 'category', 'kind', 'thumbnail', 'payload', 'triangles'])]
class LibraryItem extends Model
{
    /** @use HasFactory<LibraryItemFactory> */
    use HasFactory;

    /**
     * Matches MAX_TRIANGLES in the browser (`exchange/mesh-import.ts`) — the
     * mesh ends up inside a project document, so the same ceiling applies.
     */
    public const MAX_TRIANGLES = 20_000;

    /**
     * Whether this item can be reopened in the designer.
     */
    public function isEditable(): bool
    {
        return $this->kind === 'designed';
    }

    /**
     * Whoever saved the item.
     *
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'payload' => 'array',
        ];
    }
}
