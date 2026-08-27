<?php

namespace App\Models;

use Database\Factories\MeetingFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A booking in the studio diary.
 *
 * `starts_at` and `ends_at` hold wall-clock studio time exactly as it was
 * typed: three o'clock is stored as 15:00 and read back as 15:00. Nothing is
 * ever converted into a timezone, because a meeting belongs to the studio's
 * own clock rather than to whichever machine happens to be looking at it.
 *
 * @property int $id
 * @property int $user_id
 * @property int|null $client_id
 * @property int|null $project_id
 * @property string $title
 * @property Carbon $starts_at
 * @property Carbon|null $ends_at
 * @property string|null $location
 * @property string|null $attendees
 * @property string|null $agenda
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['title', 'starts_at', 'ends_at', 'location', 'attendees', 'agenda', 'client_id', 'project_id'])]
class Meeting extends Model
{
    /** @use HasFactory<MeetingFactory> */
    use HasFactory;

    /**
     * How long a meeting runs when no end time was given.
     */
    public const DEFAULT_MINUTES = 60;

    /**
     * The person who booked it.
     *
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * The client being met, if the meeting is with one.
     *
     * @return BelongsTo<Client, $this>
     */
    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    /**
     * The drawing under discussion, if there is one.
     *
     * @return BelongsTo<Project, $this>
     */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /**
     * Meetings falling on a run of days, oldest first.
     *
     * The comparison is on the stored wall-clock value, so the bounds must be
     * plain dates from the same clock — never `now()->utc()`.
     *
     * @param  Builder<Meeting>  $query
     * @return Builder<Meeting>
     */
    public function scopeBetweenDays(Builder $query, string $from, string $to): Builder
    {
        return $query
            ->where('starts_at', '>=', $from.' 00:00:00')
            ->where('starts_at', '<=', $to.' 23:59:59')
            ->orderBy('starts_at')
            ->orderBy('id');
    }

    /**
     * The day the meeting sits on, as the calendar grid keys its cells.
     */
    public function day(): string
    {
        return $this->starts_at->format('Y-m-d');
    }

    /**
     * How long the meeting runs, in minutes.
     */
    public function minutes(): int
    {
        if ($this->ends_at === null) {
            return self::DEFAULT_MINUTES;
        }

        return max(0, $this->starts_at->diffInMinutes($this->ends_at, absolute: true));
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'starts_at' => 'datetime',
            'ends_at' => 'datetime',
        ];
    }
}
