<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Carbon;
use Laravel\Fortify\Contracts\PasskeyUser;
use Laravel\Fortify\PasskeyAuthenticatable;
use Laravel\Fortify\TwoFactorAuthenticatable;

/**
 * @property int $id
 * @property int|null $organization_id
 * @property string $name
 * @property string $email
 * @property Carbon|null $email_verified_at
 * @property string $password
 * @property Carbon|null $signed_in_at
 * @property string|null $two_factor_secret
 * @property string|null $two_factor_recovery_codes
 * @property Carbon|null $two_factor_confirmed_at
 * @property string|null $remember_token
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['name', 'email', 'password'])]
#[Hidden(['password', 'two_factor_secret', 'two_factor_recovery_codes', 'remember_token'])]
class User extends Authenticatable implements PasskeyUser
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable, PasskeyAuthenticatable, TwoFactorAuthenticatable;

    /**
     * The projects the user has authored.
     *
     * @return HasMany<Project, $this>
     */
    public function projects(): HasMany
    {
        return $this->hasMany(Project::class);
    }

    /**
     * The clients the user keeps.
     *
     * @return HasMany<Client, $this>
     */
    public function clients(): HasMany
    {
        return $this->hasMany(Client::class);
    }

    /**
     * Mark that this user has arrived, saying whether it was their first time.
     *
     * The answer decides where they land: the front page introduces Axon on
     * the first sign-in, and every one after that goes straight to work.
     * Saved quietly so arriving does not look like account activity.
     */
    public function recordSignIn(): bool
    {
        $isFirst = $this->signed_in_at === null;

        $this->forceFill(['signed_in_at' => now()])->saveQuietly();

        return $isFirst;
    }

    /**
     * The organization the user belongs to, if any.
     *
     * @return BelongsTo<Organization, $this>
     */
    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    /**
     * Invitations sent to this user's email address that are still open.
     *
     * @return Builder<OrganizationInvitation>
     */
    public function pendingInvitations(): Builder
    {
        return OrganizationInvitation::query()
            ->pending()
            ->whereRaw('lower(email) = ?', [OrganizationInvitation::normaliseEmail($this->email)]);
    }

    /**
     * Whether this user is the business head of their organization.
     */
    public function isOrganizationHead(): bool
    {
        return $this->organization_id !== null
            && $this->organization?->owner_id === $this->id;
    }

    /**
     * Ids of everyone whose work this user can see: the whole organization
     * when they are in one, otherwise just themselves.
     *
     * @return array<int, int>
     */
    public function teamMemberIds(): array
    {
        if ($this->organization_id === null) {
            return [$this->id];
        }

        return self::query()
            ->where('organization_id', $this->organization_id)
            ->pluck('id')
            ->all();
    }

    /**
     * Every project the user can work on — the whole team's, not just their own.
     *
     * @return Builder<Project>
     */
    public function teamProjects(): Builder
    {
        return Project::query()->whereIn('user_id', $this->teamMemberIds());
    }

    /**
     * Every client the user can see.
     *
     * @return Builder<Client>
     */
    public function teamClients(): Builder
    {
        return Client::query()->whereIn('user_id', $this->teamMemberIds());
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'signed_in_at' => 'datetime',
            'two_factor_confirmed_at' => 'datetime',
        ];
    }
}
