<?php

use App\Models\Client;
use App\Models\Project;
use App\Models\User;
use Illuminate\Support\Carbon;
use Inertia\Testing\AssertableInertia;

test('guests are redirected away from the client register', function () {
    $this->get(route('clients.index'))->assertRedirect(route('login'));
});

test('the register lists only the clients a user keeps', function () {
    $user = User::factory()->create();
    Client::factory()->for($user)->create(['name' => 'Margaret Chen']);
    Client::factory()->create(['name' => 'Someone Else']);

    $this->actingAs($user)
        ->get(route('clients.index'))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('clients/index')
            ->has('clients', 1)
            ->where('clients.0.name', 'Margaret Chen')
        );
});

test('the register groups drawings under their client and lists the rest as unassigned', function () {
    $user = User::factory()->create();
    $client = Client::factory()->for($user)->create();
    Project::factory()->for($user)->create(['client_id' => $client->id, 'name' => 'Laneway']);
    Project::factory()->for($user)->create(['name' => 'Loose Drawing']);

    $this->actingAs($user)
        ->get(route('clients.index'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->has('clients.0.projects', 1)
            ->where('clients.0.projects.0.name', 'Laneway')
            ->has('unassigned', 1)
            ->where('unassigned.0.name', 'Loose Drawing')
        );
});

test('a client can be added with just a name', function () {
    $user = User::factory()->create();

    $this->actingAs($user)
        ->post(route('clients.store'), ['name' => 'New Client'])
        ->assertRedirect();

    expect($user->clients()->sole())
        ->name->toBe('New Client')
        ->company->toBeNull();
});

test('adding a client requires a name and a valid email', function () {
    $this->actingAs(User::factory()->create())
        ->post(route('clients.store'), ['email' => 'not-an-email'])
        ->assertSessionHasErrors(['name', 'email']);
});

test('renaming a client renames the title block on their drawings', function () {
    $user = User::factory()->create();
    $client = Client::factory()->for($user)->create(['name' => 'Old Name']);
    $project = Project::factory()->for($user)->create([
        'client_id' => $client->id,
        'client' => 'Old Name',
    ]);

    $this->actingAs($user)
        ->put(route('clients.update', $client), ['name' => 'New Name'])
        ->assertRedirect();

    expect($project->fresh()->client)->toBe('New Name');
});

test('a client cannot be edited by anyone else', function () {
    $client = Client::factory()->create(['name' => 'Untouched']);

    $this->actingAs(User::factory()->create())
        ->put(route('clients.update', $client), ['name' => 'Hijacked'])
        ->assertForbidden();

    expect($client->fresh()->name)->toBe('Untouched');
});

test('removing a client keeps their drawings, unassigned', function () {
    $user = User::factory()->create();
    $client = Client::factory()->for($user)->create();
    $project = Project::factory()->for($user)->create(['client_id' => $client->id]);

    $this->actingAs($user)
        ->delete(route('clients.destroy', $client))
        ->assertRedirect();

    expect(Client::query()->count())->toBe(0)
        ->and($project->fresh())
        ->not->toBeNull()
        ->client_id->toBeNull();
});

test('a drawing can be assigned to a client', function () {
    $user = User::factory()->create();
    $client = Client::factory()->for($user)->create(['name' => 'Margaret Chen']);
    $project = Project::factory()->for($user)->create(['client' => null]);

    $this->actingAs($user)
        ->post(route('clients.projects.assign', $client), ['project_id' => $project->id])
        ->assertRedirect();

    expect($project->fresh())
        ->client_id->toBe($client->id)
        // The display name follows the assignment.
        ->client->toBe('Margaret Chen');
});

test('a drawing belonging to someone else cannot be assigned', function () {
    $user = User::factory()->create();
    $client = Client::factory()->for($user)->create();
    $foreign = Project::factory()->create();

    $this->actingAs($user)
        ->post(route('clients.projects.assign', $client), ['project_id' => $foreign->id])
        ->assertSessionHasErrors('project_id');

    expect($foreign->fresh()->client_id)->toBeNull();
});

test('a drawing cannot be assigned to someone elses client', function () {
    $client = Client::factory()->create();
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();

    $this->actingAs($user)
        ->post(route('clients.projects.assign', $client), ['project_id' => $project->id])
        ->assertForbidden();
});

test('a drawing can be unassigned', function () {
    $user = User::factory()->create();
    $client = Client::factory()->for($user)->create();
    $project = Project::factory()->for($user)->create([
        'client_id' => $client->id,
        'client' => $client->name,
    ]);

    $this->actingAs($user)
        ->delete(route('clients.projects.unassign', [$client, $project]))
        ->assertRedirect();

    expect($project->fresh())
        ->client_id->toBeNull()
        ->client->toBeNull();
});

test('the register reports when a client was last worked for', function () {
    $user = User::factory()->create();
    $client = Client::factory()->for($user)->create();
    Project::factory()->for($user)->create([
        'client_id' => $client->id,
        'worked_seconds' => 900,
        'worked_at' => Carbon::parse('2026-08-24 15:00:00'),
    ]);
    Project::factory()->for($user)->create([
        'client_id' => $client->id,
        'worked_seconds' => 300,
        'worked_at' => Carbon::parse('2026-08-25 09:30:00'),
    ]);

    $this->actingAs($user)
        ->get(route('clients.index'))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('clients.0.last_worked_at', fn ($value) => str_starts_with((string) $value, '2026-08-25T09:30:00'))
        );
});

test('the register totals the hours across a clients drawings', function () {
    $user = User::factory()->create();
    $client = Client::factory()->for($user)->create();
    Project::factory()->for($user)->create([
        'client_id' => $client->id,
        'worked_seconds' => 3600,
    ]);
    Project::factory()->for($user)->create([
        'client_id' => $client->id,
        'worked_seconds' => 1800,
    ]);

    $this->actingAs($user)
        ->get(route('clients.index'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('clients.0.total_seconds', 5400)
        );
});

/*
|--------------------------------------------------------------------------
| Automatic time tracking
|--------------------------------------------------------------------------
*/

test('saves close together accumulate working time', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();
    $document = $project->document;

    Carbon::setTestNow('2026-08-25 09:00:00');
    $this->actingAs($user)
        ->putJson(route('projects.document.update', $project), ['document' => $document])
        ->assertOk();

    Carbon::setTestNow('2026-08-25 09:03:00');
    $this->putJson(route('projects.document.update', $project), ['document' => $document])
        ->assertOk();

    Carbon::setTestNow('2026-08-25 09:07:30');
    $this->putJson(route('projects.document.update', $project), ['document' => $document])
        ->assertOk();

    // Three and four and a half minutes of continuous drawing.
    expect($project->fresh()->worked_seconds)->toBe(450);

    Carbon::setTestNow();
});

test('a gap longer than the idle threshold contributes nothing', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();
    $document = $project->document;

    Carbon::setTestNow('2026-08-25 09:00:00');
    $this->actingAs($user)
        ->putJson(route('projects.document.update', $project), ['document' => $document])
        ->assertOk();

    // Lunch.
    Carbon::setTestNow('2026-08-25 12:00:00');
    $this->putJson(route('projects.document.update', $project), ['document' => $document])
        ->assertOk();

    // The afternoon session then continues normally.
    Carbon::setTestNow('2026-08-25 12:05:00');
    $this->putJson(route('projects.document.update', $project), ['document' => $document])
        ->assertOk();

    expect($project->fresh()->worked_seconds)->toBe(300);

    Carbon::setTestNow();
});

test('opening a project starts a session without counting the time away', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create([
        'worked_seconds' => 1000,
        'worked_at' => Carbon::parse('2026-08-20 09:00:00'),
    ]);

    Carbon::setTestNow('2026-08-25 09:00:00');
    $this->actingAs($user)->get(route('projects.show', $project))->assertOk();

    // Five days away adds nothing, but the session anchor moves up.
    expect($project->fresh())
        ->worked_seconds->toBe(1000)
        ->worked_at->toDateTimeString()->toBe('2026-08-25 09:00:00');

    // Drawing shortly after opening counts from the open.
    Carbon::setTestNow('2026-08-25 09:02:00');
    $this->putJson(route('projects.document.update', $project), [
        'document' => $project->document,
    ])->assertOk();

    expect($project->fresh()->worked_seconds)->toBe(1120);

    Carbon::setTestNow();
});
