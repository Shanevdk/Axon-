<?php

namespace Database\Factories;

use App\Models\Note;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Note>
 */
class NoteFactory extends Factory
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
            'project_id' => null,
            'title' => fake()->sentence(4),
            'body' => fake()->paragraph(),
            'pinned' => false,
        ];
    }

    /**
     * A note held at the top of the notebook.
     */
    public function pinned(): static
    {
        return $this->state(['pinned' => true]);
    }
}
