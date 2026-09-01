<?php

namespace Database\Factories;

use App\Models\ClaudeAccount;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ClaudeAccount>
 */
class ClaudeAccountFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            // Shaped like a real `claude setup-token` token, but not one.
            'token' => 'sk-ant-oat01-'.fake()->regexify('[A-Za-z0-9_-]{40}'),
            'verified_at' => now(),
        ];
    }
}
