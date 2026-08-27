<?php

use App\Models\Meeting;
use App\Models\Organization;
use App\Models\User;
use Inertia\Testing\AssertableInertia;

test('guests are redirected away from the chat page', function () {
    $this->get(route('chat'))->assertRedirect(route('login'));
});

test('a user without an organization is pointed at the organization page', function () {
    $this->actingAs(User::factory()->create())
        ->get(route('chat'))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('chat/index')
            ->where('organization', null)
        );
});

test('a member sees the conversation beside everyone and their presence', function () {
    $organization = Organization::factory()->create(['name' => 'Ridgeway']);
    $head = $organization->owner;
    $employee = User::factory()->create(['organization_id' => $organization->id]);

    $organization->messages()->create(['body' => 'Morning all', 'user_id' => $head->id]);

    $this->actingAs($employee)
        ->get(route('chat'))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('chat/index')
            ->where('organization.name', 'Ridgeway')
            ->has('members', 2)
            ->has('conversation', 1)
            ->where('conversation.0.body', 'Morning all')
            ->where('conversation.0.mine', false)
        );
});

/*
|--------------------------------------------------------------------------
| Presence
|--------------------------------------------------------------------------
*/

test('someone at their desk with no meeting reads as available', function () {
    $user = User::factory()->create();
    $user->forceFill(['last_active_at' => now()])->saveQuietly();

    expect($user->currentPresence()['status'])->toBe('available');
});

test('a diary booking happening now turns a member red as in a meeting', function () {
    $user = User::factory()->create();
    $user->forceFill(['last_active_at' => now()])->saveQuietly();

    Meeting::factory()->for($user)->create([
        'title' => 'Site review',
        'starts_at' => now()->subMinutes(10),
        'ends_at' => now()->addMinutes(50),
    ]);

    expect($user->currentPresence())->toMatchArray([
        'status' => 'meeting',
        'meeting' => 'Site review',
    ]);
});

test('an open-ended meeting keeps them red for the default hour only', function () {
    $user = User::factory()->create();
    $user->forceFill(['last_active_at' => now()])->saveQuietly();

    Meeting::factory()->for($user)->create([
        'starts_at' => now()->subMinutes(30),
        'ends_at' => null,
    ]);

    expect($user->currentPresence()['status'])->toBe('meeting');

    $this->travel(45)->minutes();
    $user->forceFill(['last_active_at' => now()])->saveQuietly();

    expect($user->fresh()->currentPresence()['status'])->toBe('available');
});

test('a pinned status beats the diary', function () {
    $user = User::factory()->create();
    $user->forceFill(['last_active_at' => now(), 'presence' => 'dnd'])->saveQuietly();

    Meeting::factory()->for($user)->create([
        'starts_at' => now()->subMinutes(5),
        'ends_at' => now()->addMinutes(55),
    ]);

    expect($user->currentPresence()['status'])->toBe('dnd');
});

test('absence beats everything, even a pinned status', function () {
    $user = User::factory()->create();
    $user->forceFill([
        'presence' => 'busy',
        'last_active_at' => now()->subMinutes(User::ACTIVE_WINDOW_MINUTES + 1),
    ])->saveQuietly();

    expect($user->currentPresence()['status'])->toBe('offline');
});

test('browsing the studio is the presence heartbeat', function () {
    $user = User::factory()->create();

    expect($user->last_active_at)->toBeNull();

    $this->actingAs($user)->get(route('dashboard'))->assertOk();

    expect($user->fresh()->last_active_at)->not->toBeNull();
});

/*
|--------------------------------------------------------------------------
| Setting a status
|--------------------------------------------------------------------------
*/

test('a member pins a status with a message', function () {
    $user = User::factory()->create();

    $this->actingAs($user)
        ->put(route('chat.status'), ['presence' => 'brb', 'message' => 'Coffee run'])
        ->assertRedirect();

    $user->refresh();

    expect($user->presence)->toBe('brb')
        ->and($user->presence_message)->toBe('Coffee run');
});

test('choosing automatic clears the pinned status', function () {
    $user = User::factory()->create();
    $user->forceFill(['presence' => 'busy', 'presence_message' => 'Heads down'])->saveQuietly();

    $this->actingAs($user)
        ->put(route('chat.status'), ['presence' => 'auto'])
        ->assertRedirect();

    $user->refresh();

    expect($user->presence)->toBeNull()
        ->and($user->presence_message)->toBeNull();
});

test('a made-up status is rejected', function () {
    $this->actingAs(User::factory()->create())
        ->put(route('chat.status'), ['presence' => 'gone-fishing'])
        ->assertSessionHasErrors('presence');
});

/*
|--------------------------------------------------------------------------
| Direct messages
|--------------------------------------------------------------------------
*/

test('a member texts a colleague and only the two of them see it', function () {
    $organization = Organization::factory()->create();
    $head = $organization->owner;
    $employee = User::factory()->create(['organization_id' => $organization->id]);
    $bystander = User::factory()->create(['organization_id' => $organization->id]);

    $this->actingAs($head)
        ->post(route('organization.messages.store'), [
            'body' => 'Just between us',
            'recipient_id' => $employee->id,
        ])
        ->assertRedirect();

    // Both ends of the conversation read it.
    $this->actingAs($employee)
        ->get(route('chat', ['with' => $head->id]))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('with', $head->id)
            ->has('conversation', 1)
            ->where('conversation.0.body', 'Just between us')
        );

    // A bystander's thread with the head shows none of it.
    $this->actingAs($bystander)
        ->get(route('chat', ['with' => $head->id]))
        ->assertInertia(fn (AssertableInertia $page) => $page->has('conversation', 0));
});

test('the team channel keeps private words out', function () {
    $organization = Organization::factory()->create();
    $head = $organization->owner;
    $employee = User::factory()->create(['organization_id' => $organization->id]);

    $organization->messages()->create(['body' => 'Morning all', 'user_id' => $head->id]);
    $organization->messages()->create([
        'body' => 'Just between us',
        'user_id' => $head->id,
        'recipient_id' => $employee->id,
    ]);

    $this->actingAs($employee)
        ->get(route('chat'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('with', null)
            ->has('conversation', 1)
            ->where('conversation.0.body', 'Morning all')
        );

    $this->actingAs($employee)
        ->get(route('organization.show'))
        ->assertInertia(fn (AssertableInertia $page) => $page->has('messages', 1));
});

test('a private word cannot leave the studio or loop back to its author', function () {
    $organization = Organization::factory()->create();
    $outsider = User::factory()->create();

    $this->actingAs($organization->owner)
        ->post(route('organization.messages.store'), [
            'body' => 'Psst',
            'recipient_id' => $outsider->id,
        ])
        ->assertForbidden();

    $this->actingAs($organization->owner)
        ->post(route('organization.messages.store'), [
            'body' => 'Note to self',
            'recipient_id' => $organization->owner->id,
        ])
        ->assertForbidden();
});

test('unread counts show against the sender and clear on opening the thread', function () {
    $organization = Organization::factory()->create();
    $head = $organization->owner;
    $head->forceFill(['name' => 'Alice Head'])->saveQuietly();
    $employee = User::factory()->create([
        'organization_id' => $organization->id,
        'name' => 'Bob Employee',
    ]);

    $this->actingAs($head)->post(route('organization.messages.store'), [
        'body' => 'Are you free?',
        'recipient_id' => $employee->id,
    ]);
    $this->actingAs($head)->post(route('organization.messages.store'), [
        'body' => 'It is about the roof.',
        'recipient_id' => $employee->id,
    ]);

    // Members sort by name, so Alice sits first. The badge counts against
    // her until Bob opens the thread, and reading it clears the count.
    $this->actingAs($employee)
        ->get(route('chat'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('members.0.name', 'Alice Head')
            ->where('members.0.unread', 2)
        );

    $this->actingAs($employee)->get(route('chat', ['with' => $head->id]));

    $this->actingAs($employee)
        ->get(route('chat'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('members.0.unread', 0)
        );
});
