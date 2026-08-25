<?php

use App\Models\Client;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Inertia\Testing\AssertableInertia;

test('guests are redirected away from the organization page', function () {
    $this->get(route('organization.show'))->assertRedirect(route('login'));
});

test('a user without an organization sees the create and join forms', function () {
    $this->actingAs(User::factory()->create())
        ->get(route('organization.show'))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('organization/index')
            ->where('organization', null)
        );
});

/*
|--------------------------------------------------------------------------
| Creating and joining
|--------------------------------------------------------------------------
*/

test('a business head can start an organization and is put inside it', function () {
    $user = User::factory()->create();

    $this->actingAs($user)
        ->post(route('organization.store'), ['name' => 'Ridgeway Architects'])
        ->assertRedirect();

    $organization = Organization::query()->sole();

    expect($organization->name)->toBe('Ridgeway Architects')
        ->and($organization->owner_id)->toBe($user->id)
        ->and($user->fresh()->organization_id)->toBe($organization->id)
        ->and($organization->join_code)->toMatch('/^AX-[A-Z0-9]{4}-[A-Z0-9]{4}$/');
});

test('starting an organization requires a name', function () {
    $this->actingAs(User::factory()->create())
        ->post(route('organization.store'), [])
        ->assertSessionHasErrors('name');
});

test('a user already in an organization cannot start another', function () {
    $organization = Organization::factory()->create();

    $this->actingAs($organization->owner)
        ->post(route('organization.store'), ['name' => 'Second Studio'])
        ->assertSessionHasErrors('name');

    expect(Organization::query()->count())->toBe(1);
});

test('an employee joins with the code and lands in the organization', function () {
    $organization = Organization::factory()->create(['name' => 'Ridgeway']);
    $employee = User::factory()->create();

    $this->actingAs($employee)
        ->post(route('organization.join'), ['code' => $organization->join_code])
        ->assertRedirect();

    expect($employee->fresh()->organization_id)->toBe($organization->id);
});

test('a join code is accepted in any case and without its dashes', function () {
    $organization = Organization::factory()->create();
    $employee = User::factory()->create();
    $messy = strtolower(str_replace('-', '', $organization->join_code));

    $this->actingAs($employee)
        ->post(route('organization.join'), ['code' => " {$messy} "])
        ->assertRedirect();

    expect($employee->fresh()->organization_id)->toBe($organization->id);
});

test('an unknown code is rejected', function () {
    $employee = User::factory()->create();

    $this->actingAs($employee)
        ->post(route('organization.join'), ['code' => 'AX-ZZZZ-ZZZZ'])
        ->assertSessionHasErrors('code');

    expect($employee->fresh()->organization_id)->toBeNull();
});

test('a user must leave one organization before joining another', function () {
    $first = Organization::factory()->create();
    $second = Organization::factory()->create();

    $this->actingAs($first->owner)
        ->post(route('organization.join'), ['code' => $second->join_code])
        ->assertSessionHasErrors('code');

    expect($first->owner->fresh()->organization_id)->toBe($first->id);
});

/*
|--------------------------------------------------------------------------
| Shared access
|--------------------------------------------------------------------------
*/

test('members see each others projects and clients', function () {
    $organization = Organization::factory()->create();
    $head = $organization->owner;
    $employee = User::factory()->create(['organization_id' => $organization->id]);

    Project::factory()->for($head)->create(['name' => 'Head Drawing']);
    Project::factory()->for($employee)->create(['name' => 'Employee Drawing']);
    Client::factory()->for($head)->create(['name' => 'Shared Client']);

    $this->actingAs($employee)
        ->get(route('projects.index'))
        ->assertInertia(fn (AssertableInertia $page) => $page->has('projects', 2));

    $this->actingAs($employee)
        ->get(route('clients.index'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->has('clients', 1)
            ->where('clients.0.name', 'Shared Client')
        );
});

test('a member can open and edit a teammates drawing', function () {
    $organization = Organization::factory()->create();
    $employee = User::factory()->create(['organization_id' => $organization->id]);
    $project = Project::factory()->for($organization->owner)->create();

    $this->actingAs($employee)
        ->get(route('projects.show', $project))
        ->assertOk();

    $this->actingAs($employee)
        ->putJson(route('projects.document.update', $project), [
            'document' => $project->document,
        ])
        ->assertOk();
});

test('the studio dashboard totals the whole teams work', function () {
    $organization = Organization::factory()->create();
    $head = $organization->owner;
    $employee = User::factory()->create(['organization_id' => $organization->id]);

    Project::factory()->for($head)->withSampleResidence()->create();
    Project::factory()->for($employee)->withSampleResidence()->create();

    $this->actingAs($employee)
        ->get(route('dashboard'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('totals.projects', 2)
            // Nine walls in each sample residence.
            ->where('totals.walls', 18)
        );
});

test('someone outside the organization still cannot reach the work', function () {
    $organization = Organization::factory()->create();
    $project = Project::factory()->for($organization->owner)->create();

    $this->actingAs(User::factory()->create())
        ->get(route('projects.show', $project))
        ->assertForbidden();
});

test('leaving an organization takes the shared access away', function () {
    $organization = Organization::factory()->create();
    $employee = User::factory()->create(['organization_id' => $organization->id]);
    $project = Project::factory()->for($organization->owner)->create();

    $this->actingAs($employee)->get(route('projects.show', $project))->assertOk();

    $this->actingAs($employee)->post(route('organization.leave'))->assertRedirect();

    expect($employee->fresh()->organization_id)->toBeNull();

    $this->actingAs($employee->fresh())
        ->get(route('projects.show', $project))
        ->assertForbidden();
});

/*
|--------------------------------------------------------------------------
| Running the organization
|--------------------------------------------------------------------------
*/

test('the head can rename the organization', function () {
    $organization = Organization::factory()->create(['name' => 'Old Studio']);

    $this->actingAs($organization->owner)
        ->put(route('organization.update'), ['name' => 'New Studio'])
        ->assertRedirect();

    expect($organization->fresh()->name)->toBe('New Studio');
});

test('an employee cannot rename the organization', function () {
    $organization = Organization::factory()->create(['name' => 'Untouched']);
    $employee = User::factory()->create(['organization_id' => $organization->id]);

    $this->actingAs($employee)
        ->put(route('organization.update'), ['name' => 'Hijacked'])
        ->assertForbidden();

    expect($organization->fresh()->name)->toBe('Untouched');
});

test('only the head is shown the join code', function () {
    $organization = Organization::factory()->create();
    $employee = User::factory()->create(['organization_id' => $organization->id]);

    $this->actingAs($organization->owner)
        ->get(route('organization.show'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('organization.join_code', $organization->join_code)
            ->where('organization.is_head', true)
            ->has('organization.members', 2)
        );

    $this->actingAs($employee)
        ->get(route('organization.show'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('organization.join_code', null)
            ->where('organization.is_head', false)
        );
});

test('the head can issue a new code, retiring the old one', function () {
    $organization = Organization::factory()->create();
    $original = $organization->join_code;

    $this->actingAs($organization->owner)
        ->post(route('organization.code.regenerate'))
        ->assertRedirect();

    $organization->refresh();

    expect($organization->join_code)->not->toBe($original);

    // The retired code no longer opens the door.
    $this->actingAs(User::factory()->create())
        ->post(route('organization.join'), ['code' => $original])
        ->assertSessionHasErrors('code');
});

test('an employee cannot issue a new code', function () {
    $organization = Organization::factory()->create();
    $employee = User::factory()->create(['organization_id' => $organization->id]);

    $this->actingAs($employee)
        ->post(route('organization.code.regenerate'))
        ->assertForbidden();
});

test('the head disbands rather than leaves', function () {
    $organization = Organization::factory()->create();

    $this->actingAs($organization->owner)
        ->post(route('organization.leave'))
        ->assertForbidden();

    $this->actingAs($organization->owner)
        ->delete(route('organization.destroy'))
        ->assertRedirect();

    expect(Organization::query()->count())->toBe(0)
        ->and($organization->owner->fresh()->organization_id)->toBeNull();
});

test('disbanding leaves everyones drawings intact', function () {
    $organization = Organization::factory()->create();
    $employee = User::factory()->create(['organization_id' => $organization->id]);
    Project::factory()->for($employee)->create();

    $this->actingAs($organization->owner)->delete(route('organization.destroy'));

    expect(Project::query()->count())->toBe(1)
        ->and($employee->fresh()->organization_id)->toBeNull();
});

/*
|--------------------------------------------------------------------------
| Team chat
|--------------------------------------------------------------------------
*/

test('members can talk to each other', function () {
    $organization = Organization::factory()->create();
    $employee = User::factory()->create([
        'organization_id' => $organization->id,
        'name' => 'Sam',
    ]);

    $this->actingAs($employee)
        ->post(route('organization.messages.store'), ['body' => 'Setting out drawing is up.'])
        ->assertRedirect();

    $this->actingAs($organization->owner)
        ->get(route('organization.show'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->has('messages', 1)
            ->where('messages.0.body', 'Setting out drawing is up.')
            ->where('messages.0.author', 'Sam')
            // The head is reading someone else's message.
            ->where('messages.0.mine', false)
        );
});

test('messages arrive in the order they were written', function () {
    $organization = Organization::factory()->create();

    $this->actingAs($organization->owner);
    $this->post(route('organization.messages.store'), ['body' => 'First']);
    $this->post(route('organization.messages.store'), ['body' => 'Second']);
    $this->post(route('organization.messages.store'), ['body' => 'Third']);

    $this->get(route('organization.show'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('messages.0.body', 'First')
            ->where('messages.2.body', 'Third')
            ->where('messages.2.mine', true)
        );
});

test('a message cannot be empty or unreasonably long', function () {
    $organization = Organization::factory()->create();

    $this->actingAs($organization->owner)
        ->post(route('organization.messages.store'), ['body' => '   '])
        ->assertSessionHasErrors('body');

    $this->actingAs($organization->owner)
        ->post(route('organization.messages.store'), ['body' => str_repeat('a', 2001)])
        ->assertSessionHasErrors('body');
});

test('someone with no organization cannot post', function () {
    $this->actingAs(User::factory()->create())
        ->post(route('organization.messages.store'), ['body' => 'Hello?'])
        ->assertForbidden();
});

test('the conversation is not visible from outside the organization', function () {
    $organization = Organization::factory()->create();
    $organization->messages()->create([
        'user_id' => $organization->owner_id,
        'body' => 'Private studio talk',
    ]);

    $this->actingAs(User::factory()->create())
        ->get(route('organization.show'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('organization', null)
            ->has('messages', 0)
        );
});

test('disbanding clears the conversation', function () {
    $organization = Organization::factory()->create();

    $this->actingAs($organization->owner)
        ->post(route('organization.messages.store'), ['body' => 'Goodbye']);

    $this->actingAs($organization->owner)->delete(route('organization.destroy'));

    expect(Message::query()->count())->toBe(0);
});
