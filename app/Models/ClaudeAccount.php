<?php

namespace App\Models;

use Database\Factories\ClaudeAccountFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Somebody's Claude sign-in.
 *
 * The token comes from `claude setup-token` and stands for a Claude
 * subscription, not an API key: turns taken with it are drawn from that
 * person's own plan. It is encrypted at rest, hidden from serialization, and
 * only ever leaves this server as an environment variable handed to the CLI.
 *
 * @property int $id
 * @property int $user_id
 * @property string $token
 * @property Carbon|null $verified_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['token', 'verified_at'])]
#[Hidden(['token'])]
class ClaudeAccount extends Model
{
    /** @use HasFactory<ClaudeAccountFactory> */
    use HasFactory;

    /**
     * Whose sign-in this is.
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
            'token' => 'encrypted',
            'verified_at' => 'datetime',
        ];
    }
}
