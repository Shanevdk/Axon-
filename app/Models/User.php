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
 * @property string|null $presence
 * @property string|null $presence_message
 * @property Carbon|null $last_active_at
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
     * Statuses a member can pin on themselves. `meeting` is never among them:
     * it is only ever derived from the studio diary.
     *
     * @var array<int, string>
     */
    public const MANUAL_PRESENCES = ['available', 'busy', 'dnd', 'brb', 'away', 'offline'];

    /**
     * How recently someone must have been seen to count as present at all.
     */
    public const ACTIVE_WINDOW_MINUTES = 5;

    /**
     * How often the activity heartbeat is worth writing down.
     */
    private const ACTIVITY_WRITE_SECONDS = 60;

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
     * The notes this user has written.
     *
     * @return HasMany<Note, $this>
     */
    public function notes(): HasMany
    {
        return $this->hasMany(Note::class);
    }

    /**
     * The meetings this user has booked.
     *
     * @return HasMany<Meeting, $this>
     */
    public function meetings(): HasMany
    {
        return $this->hasMany(Meeting::class);
    }

    /**
     * The library items this user has saved.
     *
     * @return HasMany<LibraryItem, $this>
     */
    public function libraryItems(): HasMany
    {
        return $this->hasMany(LibraryItem::class);
    }

    /**
     * The user's own AI accounts, connected to the item designer.
     *
     * @return HasMany<AiConnection, $this>
     */
    public function aiConnections(): HasMany
    {
        return $this->hasMany(AiConnection::class);
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
     * Note that this user is at their desk right now.
     *
     * Called from middleware on every request, so it only writes once a
     * minute, and quietly — being present is not account activity.
     */
    public function recordActivity(): void
    {
        if ($this->last_active_at !== null
            && $this->last_active_at->gt(now()->subSeconds(self::ACTIVITY_WRITE_SECONDS))) {
            return;
        }

        $this->forceFill(['last_active_at' => now()])->saveQuietly();
    }

    /**
     * The diary booking this user is sitting in right now, if any.
     *
     * Meetings hold wall-clock studio time, so the comparison uses the
     * studio's own clock — never a timezone conversion.
     */
    public function currentMeeting(): ?Meeting
    {
        return $this->meetings()
            ->where('starts_at', '<=', now())
            ->where(function ($query) {
                $query->where('ends_at', '>=', now())
                    ->orWhere(function ($query) {
                        $query->whereNull('ends_at')
                            ->where('starts_at', '>', now()->subMinutes(Meeting::DEFAULT_MINUTES));
                    });
            })
            ->orderByDesc('starts_at')
            ->first();
    }

    /**
     * The presence shown against this user's name, Teams-fashion.
     *
     * Absence beats everything: someone not seen inside the active window is
     * offline no matter what they pinned. After that a pinned status wins,
     * then a meeting happening now in the diary, and otherwise available.
     *
     * Named apart from the `presence` column: an attribute and a method
     * sharing a name makes Eloquent try to resolve the column as a relation.
     *
     * @return array{status: string, message: string|null, meeting: string|null}
     */
    public function currentPresence(): array
    {
        $message = $this->presence_message;

        if ($this->last_active_at === null
            || $this->last_active_at->lt(now()->subMinutes(self::ACTIVE_WINDOW_MINUTES))) {
            return ['status' => 'offline', 'message' => $message, 'meeting' => null];
        }

        if ($this->presence !== null) {
            return ['status' => $this->presence, 'message' => $message, 'meeting' => null];
        }

        $meeting = $this->currentMeeting();

        if ($meeting !== null) {
            return ['status' => 'meeting', 'message' => $message, 'meeting' => $meeting->title];
        }

        return ['status' => 'available', 'message' => $message, 'meeting' => null];
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
     * Every note in the studio notebook this user can read.
     *
     * @return Builder<Note>
     */
    public function teamNotes(): Builder
    {
        return Note::query()->whereIn('user_id', $this->teamMemberIds());
    }

    /**
     * Every meeting in the studio diary this user can see.
     *
     * @return Builder<Meeting>
     */
    public function teamMeetings(): Builder
    {
        return Meeting::query()->whereIn('user_id', $this->teamMemberIds());
    }

    /**
     * Every item on the studio's library shelf.
     *
     * @return Builder<LibraryItem>
     */
    public function teamLibraryItems(): Builder
    {
        return LibraryItem::query()->whereIn('user_id', $this->teamMemberIds());
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
            'last_active_at' => 'datetime',
            'two_factor_confirmed_at' => 'datetime',
        ];
    }
}
