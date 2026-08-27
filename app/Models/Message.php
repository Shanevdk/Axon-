<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A message in the studio: to everyone when `recipient_id` is null, and a
 * private word between two members when it is set.
 *
 * @property int $id
 * @property int $organization_id
 * @property int $user_id
 * @property int|null $recipient_id
 * @property string $body
 * @property Carbon|null $read_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['body', 'user_id', 'recipient_id'])]
class Message extends Model
{
    /**
     * The organization the message was posted in.
     *
     * @return BelongsTo<Organization, $this>
     */
    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    /**
     * The member who wrote it.
     *
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * The member it was said to, when it was said to one person.
     *
     * @return BelongsTo<User, $this>
     */
    public function recipient(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recipient_id');
    }

    /**
     * Only what was said to the whole team.
     *
     * @param  Builder<Message>  $query
     * @return Builder<Message>
     */
    public function scopeChannel(Builder $query): Builder
    {
        return $query->whereNull('recipient_id');
    }

    /**
     * The private conversation between two members, in both directions.
     *
     * @param  Builder<Message>  $query
     * @return Builder<Message>
     */
    public function scopeBetween(Builder $query, User $one, User $other): Builder
    {
        return $query->where(function (Builder $query) use ($one, $other) {
            $query->where(function (Builder $query) use ($one, $other) {
                $query->where('user_id', $one->id)->where('recipient_id', $other->id);
            })->orWhere(function (Builder $query) use ($one, $other) {
                $query->where('user_id', $other->id)->where('recipient_id', $one->id);
            });
        });
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'read_at' => 'datetime',
        ];
    }
}
