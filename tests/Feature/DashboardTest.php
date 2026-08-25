<?php

use App\Models\Project;
use App\Models\User;
use Inertia\Testing\AssertableInertia;

test('guests are redirected to the login page', function () {
    $response = $this->get(route('dashboard'));
    $response->assertRedirect(route('login'));
});

test('authenticated users can visit the dashboard', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $response = $this->get(route('dashboard'));
    $response->assertOk();
});

test('the dashboard totals the whole practice', function () {
    $user = User::factory()->create();
    Project::factory()->for($user)->withSampleResidence()->create();
    Project::factory()->for($user)->create();

    $this->actingAs($user)
        ->get(route('dashboard'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('dashboard')
            ->has('projects', 2)
            ->where('totals.projects', 2)
            ->where('totals.walls', 9)
            ->where('totals.rooms', 5)
            ->where('totals.openings', 14)
            // Six levels, three from each of the two projects.
            ->where('totals.levels', 6)
        );
});

test('the dashboard measures wall length and slab area from the model', function () {
    $user = User::factory()->create();
    Project::factory()->for($user)->withSampleResidence()->create();

    $this->actingAs($user)
        ->get(route('dashboard'))
        ->assertInertia(function (AssertableInertia $page) {
            // Shell 12+9+12+9 m, partitions 9+5+3+4+4 m.
            expect($page->toArray()['props']['totals']['wallLength'])
                ->toEqualWithDelta(67_000, 1);

            // The slab is 12.302 x 9.302 m.
            expect($page->toArray()['props']['totals']['slabArea'])
                ->toEqualWithDelta(114_433_204, 1);
        });
});

test('the dashboard groups wall length by type', function () {
    $user = User::factory()->create();
    Project::factory()->for($user)->withSampleResidence()->create();

    $this->actingAs($user)
        ->get(route('dashboard'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            // Longest first: 42 m of exterior brick beats the partitions.
            ->where('wallTypes.0.name', 'Exterior - Brick on Stud')
            ->where('wallTypes.0.length', 42_000)
        );
});

test('the dashboard sends a plan preview holding only the busiest level', function () {
    $user = User::factory()->create();
    Project::factory()->for($user)->withSampleResidence()->create();

    $this->actingAs($user)
        ->get(route('dashboard'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->has('projects.0.preview.levels', 1)
            ->where('projects.0.preview.levels.0.id', 'level-1')
            // Nine walls, fourteen openings, five rooms and the slab.
            ->has('projects.0.preview.elements', 29)
        );
});

test('a project with nothing drawn has no plan preview', function () {
    $user = User::factory()->create();
    Project::factory()->for($user)->create();

    $this->actingAs($user)
        ->get(route('dashboard'))
        ->assertInertia(fn (AssertableInertia $page) => $page->where('projects.0.preview', null));
});

test('the dashboard only counts the projects a user owns', function () {
    $user = User::factory()->create();
    Project::factory()->for($user)->create();
    Project::factory()->withSampleResidence()->create();

    $this->actingAs($user)
        ->get(route('dashboard'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->has('projects', 1)
            ->where('totals.projects', 1)
            ->where('totals.walls', 0)
        );
});
