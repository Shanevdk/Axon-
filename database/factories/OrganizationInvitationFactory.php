<?php

namespace Database\Factories;

use App\Models\Organization;
use App\Models\OrganizationInvitation;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<OrganizationInvitation>
 */
class OrganizationInvitationFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $organization = Organization::factory();

        return [
            'organization_id' => $organization,
            'invited_by' => fn (array $attributes): int => Organization::query()
                ->findOrFail($attributes['organization_id'])
                ->owner_id,
            'email' => fake()->unique()->safeEmail(),
            'token' => OrganizationInvitation::generateToken(),
            'accepted_at' => null,
        ];
    }

    /**
     * An invitation that sat unanswered for too long.
     */
    public function expired(): static
    {
        return $this->state(fn (): array => [
            'created_at' => now()->subDays(OrganizationInvitation::EXPIRY_DAYS + 1),
        ]);
    }
}
