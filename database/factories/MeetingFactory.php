<?php

namespace Database\Factories;

use App\Models\Meeting;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Carbon;

/**
 * @extends Factory<Meeting>
 */
class MeetingFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $starts = Carbon::today()->addDays(fake()->numberBetween(0, 20))->setTime(
            fake()->numberBetween(9, 16),
            fake()->randomElement([0, 30]),
        );

        return [
            'user_id' => User::factory(),
            'client_id' => null,
            'project_id' => null,
            'title' => fake()->randomElement([
                'Design review',
                'Site walk',
                'Council pre-application',
                'Client presentation',
                'Consultant coordination',
            ]),
            'starts_at' => $starts,
            'ends_at' => $starts->copy()->addHour(),
            'location' => fake()->boolean(70) ? fake()->streetAddress() : null,
            'attendees' => null,
            'agenda' => null,
        ];
    }

    /**
     * A meeting sitting on a particular day, at a particular wall-clock time.
     */
    public function on(string $date, string $time = '10:00'): static
    {
        return $this->state(function () use ($date, $time): array {
            $starts = Carbon::parse("{$date} {$time}");

            return [
                'starts_at' => $starts,
                'ends_at' => $starts->copy()->addHour(),
            ];
        });
    }
}
