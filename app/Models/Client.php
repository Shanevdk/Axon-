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
use Illuminate\Support\Str;

/**
 * @property int $id
 * @property int $user_id
 * @property string $name
 * @property string|null $portal_username
 * @property string|null $portal_number
 * @property Carbon|null $portal_seen_at
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
     * Digits in a portal number.
     *
     * The number is the whole of the client's credential, so it is long
     * enough that guessing it is not worth anybody's afternoon. Twelve digits
     * is a trillion of them, and it still reads over the phone in three
     * groups of four.
     */
    public const NUMBER_DIGITS = 12;

    /**
     * Issue portal credentials to every client as they are added, whoever
     * adds them — the register, a seeder or a test factory.
     */
    protected static function booted(): void
    {
        static::creating(function (Client $client): void {
            $client->portal_username ??= self::generatePortalUsername($client->name);
            $client->portal_number ??= self::generatePortalNumber();
        });
    }

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

    /**
     * Everything the client has said about their drawings.
     *
     * @return HasMany<ClientComment, $this>
     */
    public function comments(): HasMany
    {
        return $this->hasMany(ClientComment::class);
    }

    /**
     * The portal number in the shape it is read out and printed: three groups
     * of four, 0000-0000-0000.
     */
    public function formattedPortalNumber(): string
    {
        return implode('-', str_split((string) $this->portal_number, 4));
    }

    /**
     * Issue a fresh number, which retires the old one immediately.
     */
    public function reissuePortalNumber(): void
    {
        $this->forceFill(['portal_number' => self::generatePortalNumber()])->save();
    }

    /**
     * Note that the client has just looked in, throttled to one write an hour
     * so that reading a page is not also a write on every request.
     */
    public function recordPortalVisit(): void
    {
        if ($this->portal_seen_at?->isAfter(now()->subHour())) {
            return;
        }

        $this->forceFill(['portal_seen_at' => now()])->saveQuietly();
    }

    /**
     * Find the client holding this number, however it was typed.
     */
    public static function findByPortalNumber(string $number): ?self
    {
        $digits = self::normalisePortalNumber($number);

        if (strlen($digits) !== self::NUMBER_DIGITS) {
            return null;
        }

        return self::query()->where('portal_number', $digits)->first();
    }

    /**
     * A readable handle for the client, unique across the register.
     */
    public static function generatePortalUsername(string $name): string
    {
        $base = Str::slug($name) ?: 'client';
        $username = $base;

        for ($suffix = 2; self::query()->where('portal_username', $username)->exists(); $suffix++) {
            $username = $base.'-'.$suffix;
        }

        return $username;
    }

    /**
     * A number no other client holds.
     */
    public static function generatePortalNumber(): string
    {
        do {
            $number = collect(range(1, self::NUMBER_DIGITS))
                ->map(fn (): string => (string) random_int(0, 9))
                ->implode('');
        } while (self::query()->where('portal_number', $number)->exists());

        return $number;
    }

    /**
     * Clients type the number with whatever spacing or dashes they like, and
     * paste it with the odd stray space. Only the digits matter.
     */
    public static function normalisePortalNumber(string $number): string
    {
        return preg_replace('/\D/', '', $number) ?? '';
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'portal_seen_at' => 'datetime',
        ];
    }
}
