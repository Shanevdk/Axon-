<?php

namespace Database\Factories;

use App\Actions\Projects\BuildStarterDocument;
use App\Models\Project;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Project>
 */
class ProjectFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'name' => fake()->streetName().' Residence',
            'number' => (string) fake()->numberBetween(2100, 2699),
            'client' => fake()->name(),
            'address' => fake()->streetAddress().', Vancouver, BC',
            'units' => 'metric',
            'document' => app(BuildStarterDocument::class)->empty(),
            'opened_at' => now(),
        ];
    }

    /**
     * Seed the project with the sample single storey residence.
     */
    public function withSampleResidence(): static
    {
        return $this->state(fn (array $attributes): array => [
            'document' => app(BuildStarterDocument::class)->sampleResidence($attributes['units'] ?? 'metric'),
        ]);
    }

    /**
     * Indicate that the project has never been opened.
     */
    public function neverOpened(): static
    {
        return $this->state(fn (array $attributes): array => [
            'opened_at' => null,
        ]);
    }
}
