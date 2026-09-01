<?php

namespace Database\Factories;

use App\Models\Client;
use App\Models\ClientComment;
use App\Models\Project;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ClientComment>
 */
class ClientCommentFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'client_id' => Client::factory(),
            'project_id' => Project::factory(),
            'body' => fake()->sentence(),
        ];
    }
}
