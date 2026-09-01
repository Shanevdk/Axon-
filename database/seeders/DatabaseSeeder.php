<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        /*
         * The example account, for showing Vanhaven to somebody without handing
         * over a real one. Its password is deliberately simple and is set
         * here rather than registered, because the registration rules would
         * — rightly — refuse it.
         *
         * Do not seed this into anything the public can reach.
         */
        User::query()->updateOrCreate(
            ['email' => 'example@example.com'],
            [
                'name' => 'Example',
                'password' => '1234567890',
                'email_verified_at' => now(),
            ],
        );

        User::query()->updateOrCreate(
            ['email' => 'test@example.com'],
            [
                'name' => 'Test User',
                'password' => '1234567890',
                'email_verified_at' => now(),
            ],
        );

        $this->call(ProjectSeeder::class);
    }
}
