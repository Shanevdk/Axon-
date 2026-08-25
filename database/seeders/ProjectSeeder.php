<?php

namespace Database\Seeders;

use App\Models\Client;
use App\Models\Project;
use App\Models\User;
use Illuminate\Database\Seeder;

class ProjectSeeder extends Seeder
{
    /**
     * Seed a client with a worked example, plus a blank unassigned project.
     */
    public function run(): void
    {
        User::query()->each(function (User $user): void {
            $client = Client::factory()->for($user)->create([
                'name' => 'Margaret Chen',
                'company' => 'Chen Family Holdings',
                'email' => 'margaret@example.com',
                'phone' => '604 555 0142',
                'notes' => 'Prefers site meetings on Thursdays.',
            ]);

            $project = Project::factory()
                ->for($user)
                ->withSampleResidence()
                ->create([
                    'client_id' => $client->id,
                    'name' => 'Kitsilano Laneway House',
                    'number' => '2601',
                    'client' => $client->name,
                    'address' => '2244 W 7th Ave, Vancouver, BC',
                ]);

            // A believable amount of drawing time on the sample.
            $project->forceFill([
                'worked_seconds' => 4 * 3600 + 25 * 60,
                'worked_at' => now()->subDay(),
            ])->saveQuietly();

            Project::factory()
                ->for($user)
                ->neverOpened()
                ->create([
                    'name' => 'Untitled Project',
                    'number' => '2602',
                    'client' => null,
                    'address' => null,
                ]);
        });
    }
}
