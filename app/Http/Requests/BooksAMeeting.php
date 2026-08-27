<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Support\Carbon;

/**
 * The shared shape of a booking form.
 *
 * The browser sends a day and two wall-clock times rather than a timestamp,
 * and they are stitched together here without any timezone conversion. Ten in
 * the morning is stored as 10:00 and comes back as 10:00 on every machine.
 */
trait BooksAMeeting
{
    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    protected function bookingRules(mixed $clientExists, mixed $projectExists): array
    {
        return [
            'title' => ['required', 'string', 'max:160'],
            'date' => ['required', 'date_format:Y-m-d'],
            'start_time' => ['required', 'date_format:H:i'],
            'end_time' => ['nullable', 'date_format:H:i', 'after:start_time'],
            'location' => ['nullable', 'string', 'max:160'],
            'attendees' => ['nullable', 'string', 'max:255'],
            'agenda' => ['nullable', 'string', 'max:5000'],
            'client_id' => ['nullable', $clientExists],
            'project_id' => ['nullable', $projectExists],
        ];
    }

    /**
     * The validated booking as the model stores it.
     *
     * @return array<string, mixed>
     */
    public function booking(): array
    {
        $validated = $this->validated();

        return [
            'title' => $validated['title'],
            'starts_at' => Carbon::createFromFormat(
                'Y-m-d H:i',
                "{$validated['date']} {$validated['start_time']}",
            ),
            'ends_at' => isset($validated['end_time'])
                ? Carbon::createFromFormat('Y-m-d H:i', "{$validated['date']} {$validated['end_time']}")
                : null,
            'location' => $validated['location'] ?? null,
            'attendees' => $validated['attendees'] ?? null,
            'agenda' => $validated['agenda'] ?? null,
            'client_id' => $validated['client_id'] ?? null,
            'project_id' => $validated['project_id'] ?? null,
        ];
    }
}
