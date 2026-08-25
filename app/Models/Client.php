<?php

namespace App\Models;

use Carbon\CarbonInterface;
use Database\Factories\ClientFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * @property int $id
 * @property int $user_id
 * @property string $name
 * @property string|null $company
 * @property string|null $email
 * @property string|null $phone
 * @property string|null $notes
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['name', 'company', 'email', 'phone', 'notes'])]
class Client extends Model
{
    /** @use HasFactory<ClientFactory> */
    use HasFactory;

    /**
     * The architect who keeps this client.
     *
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * The drawings assigned to this client.
     *
     * @return HasMany<Project, $this>
     */
    public function projects(): HasMany
    {
        return $this->hasMany(Project::class);
    }

    /**
     * Total active editing time across every assigned drawing, in seconds.
     */
    public function totalWorkedSeconds(): int
    {
        return (int) $this->projects->sum('worked_seconds');
    }

    /**
     * The most recent moment any assigned drawing was worked on.
     */
    public function lastWorkedAt(): ?CarbonInterface
    {
        /** @var CarbonInterface|null */
        return $this->projects->max('worked_at');
    }
}
