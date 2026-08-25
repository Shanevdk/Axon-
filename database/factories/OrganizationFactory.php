<?php

namespace Database\Factories;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Organization>
 */
class OrganizationFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'owner_id' => User::factory(),
            'name' => fake()->company(),
            'join_code' => Organization::generateJoinCode(),
        ];
    }

    /**
     * Put the owner inside their own organization, the way creation does.
     */
    public function configure(): static
    {
        return $this->afterCreating(function (Organization $organization): void {
            $organization->owner()->update(['organization_id' => $organization->id]);
        });
    }
}
