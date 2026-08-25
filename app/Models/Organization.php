<?php

namespace App\Models;

use Database\Factories\OrganizationFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * @property int $id
 * @property int $owner_id
 * @property string $name
 * @property string $join_code
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['name'])]
class Organization extends Model
{
    /** @use HasFactory<OrganizationFactory> */
    use HasFactory;

    /**
     * Characters used in join codes. No zero, O, one or I — the code will be
     * read over the phone and typed from a sticky note.
     */
    private const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

    /**
     * The business head who started the organization.
     *
     * @return BelongsTo<User, $this>
     */
    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    /**
     * Everyone in the organization, the head included.
     *
     * @return HasMany<User, $this>
     */
    public function members(): HasMany
    {
        return $this->hasMany(User::class);
    }

    /**
     * Everyone who has been emailed an invitation.
     *
     * @return HasMany<OrganizationInvitation, $this>
     */
    public function invitations(): HasMany
    {
        return $this->hasMany(OrganizationInvitation::class);
    }

    /**
     * The team conversation.
     *
     * @return HasMany<Message, $this>
     */
    public function messages(): HasMany
    {
        return $this->hasMany(Message::class);
    }

    /**
     * Generate a join code no other organization is using, in the shape
     * AX-XXXX-XXXX.
     */
    public static function generateJoinCode(): string
    {
        do {
            $chunk = fn (): string => collect(range(1, 4))
                ->map(fn (): string => self::CODE_ALPHABET[random_int(0, strlen(self::CODE_ALPHABET) - 1)])
                ->implode('');

            $code = 'AX-'.$chunk().'-'.$chunk();
        } while (self::query()->where('join_code', $code)->exists());

        return $code;
    }

    /**
     * Normalise a code the way users actually type them: any case, with or
     * without the dashes.
     */
    public static function normaliseJoinCode(string $code): string
    {
        $bare = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $code) ?? '');

        if (str_starts_with($bare, 'AX') && strlen($bare) === 10) {
            return 'AX-'.substr($bare, 2, 4).'-'.substr($bare, 6, 4);
        }

        return $bare === '' ? $code : $bare;
    }
}
