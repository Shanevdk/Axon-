<?php

namespace App\Models;

use Carbon\CarbonInterface;
use Database\Factories\OrganizationInvitationFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * @property int $id
 * @property int $organization_id
 * @property int|null $invited_by
 * @property string $email
 * @property string $token
 * @property Carbon|null $accepted_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['email'])]
class OrganizationInvitation extends Model
{
    /** @use HasFactory<OrganizationInvitationFactory> */
    use HasFactory;

    /**
     * How long an invitation stays good for. Long enough to survive a holiday,
     * short enough that a forwarded email does not open the studio a year on.
     */
    public const EXPIRY_DAYS = 14;

    /**
     * The organization the invitation opens.
     *
     * @return BelongsTo<Organization, $this>
     */
    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    /**
     * The member who sent it.
     *
     * @return BelongsTo<User, $this>
     */
    public function inviter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'invited_by');
    }

    /**
     * Invitations that are still worth acting on: unaccepted and unexpired.
     *
     * @param  Builder<$this>  $query
     */
    #[Scope]
    protected function pending(Builder $query): void
    {
        $query->whereNull('accepted_at')
            ->where('created_at', '>', now()->subDays(self::EXPIRY_DAYS));
    }

    /**
     * Whether this invitation can still be accepted.
     */
    public function isPending(): bool
    {
        return $this->accepted_at === null && $this->expiresAt()->isFuture();
    }

    /**
     * The moment the invitation stops working.
     */
    public function expiresAt(): CarbonInterface
    {
        return ($this->created_at ?? now())->addDays(self::EXPIRY_DAYS);
    }

    /**
     * The one-click link that carries the invitation.
     */
    public function url(): string
    {
        return route('invitations.accept', ['token' => $this->token]);
    }

    /**
     * Put the user into the organization and close the invitation.
     */
    public function claim(User $user): void
    {
        $user->organization()->associate($this->organization)->save();

        $this->forceFill(['accepted_at' => now()])->save();
    }

    /**
     * A token nobody can guess.
     */
    public static function generateToken(): string
    {
        return Str::random(48);
    }

    /**
     * Addresses are matched case-insensitively — people capitalise their own
     * email inconsistently and an invitation should not care.
     */
    public static function normaliseEmail(string $email): string
    {
        return Str::lower(trim($email));
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'accepted_at' => 'datetime',
        ];
    }
}
