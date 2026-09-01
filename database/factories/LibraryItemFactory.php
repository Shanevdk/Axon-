<?php

namespace Database\Factories;

use App\Models\LibraryItem;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<LibraryItem>
 */
class LibraryItemFactory extends Factory
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
            'name' => fake()->randomElement(['Couch', 'Side Table', 'Reading Chair', 'Pendant Light']),
            'category' => 'Furniture',
            'kind' => 'imported',
            'thumbnail' => 'data:image/svg+xml;charset=utf-8,'.rawurlencode(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><polygon points="0,0 10,0 5,10" fill="rgb(120,120,120)"/></svg>'
            ),
            'payload' => self::payload(),
            'triangles' => 1,
        ];
    }

    /**
     * An item that was designed in Vanhaven and keeps its part list.
     */
    public function designed(): static
    {
        return $this->state([
            'kind' => 'designed',
            'payload' => self::payload([
                [
                    'id' => 'part-1',
                    'name' => 'Seat',
                    'shape' => 'box',
                    'width' => 600,
                    'depth' => 600,
                    'height' => 400,
                    'x' => 0,
                    'y' => 0,
                    'z' => 0,
                    'rotation' => 0,
                ],
            ]),
        ]);
    }

    /**
     * One triangle, enough to be a valid mesh everywhere it travels.
     *
     * @param  array<int, array<string, mixed>>|null  $parts
     * @return array<string, mixed>
     */
    public static function payload(?array $parts = null): array
    {
        return [
            'vertices' => [-300.0, -300.0, 0.0, 300.0, -300.0, 0.0, 0.0, 300.0, 400.0],
            'footprint' => [
                ['x' => -300, 'y' => -300],
                ['x' => 300, 'y' => -300],
                ['x' => 0, 'y' => 300],
            ],
            'size' => ['x' => 600, 'y' => 600, 'z' => 400],
            'triangleCount' => 1,
            ...($parts !== null ? ['parts' => $parts] : []),
        ];
    }
}
