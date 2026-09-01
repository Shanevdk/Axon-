<?php

use App\Http\Middleware\EnsureClientSignedIn;
use App\Models\Client;
use App\Models\ClientComment;
use App\Models\Project;
use App\Models\User;
use Inertia\Testing\AssertableInertia;

/**
 * Sign a client in the way the portal does, without going through the door.
 */
function asClient(Client $client): void
{
    session([EnsureClientSignedIn::SESSION_KEY => $client->id]);
}

test('a client is issued a username and a number as they are added', function () {
    $client = Client::factory()->create(['name' => 'Margaret Chen']);

    expect($client->portal_username)->toBe('margaret-chen')
        ->and($client->portal_number)->toHaveLength(Client::NUMBER_DIGITS)
        ->and($client->portal_number)->toMatch('/^\d+$/');
});

test('two clients of the same name get different usernames and numbers', function () {
    $first = Client::factory()->create(['name' => 'Margaret Chen']);
    $second = Client::factory()->create(['name' => 'Margaret Chen']);

    expect($second->portal_username)->toBe('margaret-chen-2')
        ->and($second->portal_username)->not->toBe($first->portal_username)
        ->and($second->portal_number)->not->toBe($first->portal_number);
});

test('the number is shown to the studio in groups of four', function () {
    $client = Client::factory()->create();
    $client->forceFill(['portal_number' => '123456789012'])->save();

    expect($client->formattedPortalNumber())->toBe('1234-5678-9012');
});

test('a number opens the portal', function () {
    $client = Client::factory()->create();

    $this->post(route('portal.open'), ['number' => $client->portal_number])
        ->assertRedirect(route('portal.show'));

    expect(session(EnsureClientSignedIn::SESSION_KEY))->toBe($client->id);
});

test('the number is accepted however it is typed', function () {
    $client = Client::factory()->create();
    $client->forceFill(['portal_number' => '123456789012'])->save();

    $this->post(route('portal.open'), ['number' => ' 1234-5678 9012 '])
        ->assertRedirect(route('portal.show'));
});

test('a number that belongs to nobody is refused', function () {
    $this->post(route('portal.open'), ['number' => '999999999999'])
        ->assertSessionHasErrors('number');

    expect(session()->has(EnsureClientSignedIn::SESSION_KEY))->toBeFalse();
});

test('a number of the wrong length is refused without a lookup', function () {
    Client::factory()->create();

    $this->post(route('portal.open'), ['number' => '1234'])
        ->assertSessionHasErrors('number');
});

test('the session id changes when a number is accepted', function () {
    $client = Client::factory()->create();

    $this->get(route('portal.enter'));
    $before = session()->getId();

    $this->post(route('portal.open'), ['number' => $client->portal_number]);

    expect(session()->getId())->not->toBe($before);
});

test('guessing at numbers is rationed', function () {
    // Six tries against a number nobody holds: the sixth is turned away by
    // the throttle rather than the validator.
    foreach (range(1, 5) as $ignored) {
        $this->post(route('portal.open'), ['number' => '999999999999'])
            ->assertSessionHasErrors('number');
    }

    $this->post(route('portal.open'), ['number' => '999999999999'])
        ->assertStatus(429);
});

test('progress is out of reach without a number', function () {
    $this->get(route('portal.show'))->assertRedirect(route('portal.enter'));
});

test('a client sees progress on their own drawings', function () {
    $client = Client::factory()->create(['name' => 'Margaret Chen']);
    Project::factory()->for($client->user)->create([
        'client_id' => $client->id,
        'name' => 'Chen Residence',
        'worked_seconds' => 3600,
    ]);

    asClient($client);

    $this->get(route('portal.show'))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('portal/show')
            ->where('client.name', 'Margaret Chen')
            ->has('drawings', 1)
            ->where('drawings.0.name', 'Chen Residence')
            ->where('total_seconds', 3600)
        );
});

test('a client never sees another client\'s drawings', function () {
    $client = Client::factory()->create();
    $other = Client::factory()->create();
    Project::factory()->for($other->user)->create([
        'client_id' => $other->id,
        'name' => 'Somebody Else House',
    ]);

    asClient($client);

    $this->get(route('portal.show'))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->has('drawings', 0));
});

test('the portal never sends the full model document', function () {
    $client = Client::factory()->create();
    Project::factory()->for($client->user)->create(['client_id' => $client->id]);

    asClient($client);

    $this->get(route('portal.show'))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->missing('drawings.0.document'));
});

test('a portal session opens no door into the studio', function () {
    $client = Client::factory()->create();
    $project = Project::factory()->for($client->user)->create(['client_id' => $client->id]);

    asClient($client);

    // Holding a number is not holding an account: everything that reads or
    // writes a drawing still wants a signed-in user.
    $this->get(route('projects.show', $project))->assertRedirect(route('login'));
    $this->put(route('projects.document.update', $project), ['document' => []])
        ->assertRedirect(route('login'));
    $this->get(route('clients.index'))->assertRedirect(route('login'));
});

test('a client can open their house in 3d', function () {
    $client = Client::factory()->create();
    $project = Project::factory()->for($client->user)->withSampleResidence()->create([
        'client_id' => $client->id,
        'name' => 'Chen Residence',
    ]);

    asClient($client);

    $this->get(route('portal.tour', $project))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('portal/tour')
            ->where('drawing.name', 'Chen Residence')
            ->has('model.elements')
            ->has('model.levels')
            ->where('whole_building', true)
        );
});

test('the tour walks the published client model, not the one level preview', function () {
    $client = Client::factory()->create();

    // What the editor leaves behind once the model lives on a machine: the
    // document is a single level for the thumbnail, and the whole house is
    // published alongside it.
    $project = Project::factory()->for($client->user)->create([
        'client_id' => $client->id,
        'has_local_model' => true,
        'document' => [
            'version' => 1,
            'units' => 'metric',
            'levels' => [['id' => 'level-1', 'name' => 'Ground', 'elevation' => 0]],
            'wallTypes' => [],
            'doorTypes' => [],
            'windowTypes' => [],
            'elements' => [['id' => 'w1', 'kind' => 'wall', 'level' => 'level-1']],
            'viewSettings' => [],
        ],
        'client_model' => [
            'version' => 1,
            'units' => 'metric',
            'levels' => [
                ['id' => 'level-1', 'name' => 'Ground', 'elevation' => 0],
                ['id' => 'level-2', 'name' => 'Upper', 'elevation' => 3000],
            ],
            'wallTypes' => [],
            'doorTypes' => [],
            'windowTypes' => [],
            'elements' => [
                ['id' => 'w1', 'kind' => 'wall', 'level' => 'level-1'],
                ['id' => 'w2', 'kind' => 'wall', 'level' => 'level-2'],
            ],
            'viewSettings' => [],
        ],
    ]);

    asClient($client);

    $this->get(route('portal.tour', $project))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->has('model.levels', 2)
            ->has('model.elements', 2)
            ->where('whole_building', true)
        );
});

test('a client is told when only one floor reached the portal', function () {
    $client = Client::factory()->create();

    // An older drawing: the model moved onto a machine before the portal
    // existed, so all the server has is the thumbnail's level.
    $project = Project::factory()->for($client->user)->withSampleResidence()->create([
        'client_id' => $client->id,
        'has_local_model' => true,
        'client_model' => null,
    ]);

    asClient($client);

    $this->get(route('portal.tour', $project))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->where('whole_building', false));
});

test('a drawing with nothing built in it offers no tour', function () {
    $client = Client::factory()->create();
    $project = Project::factory()->for($client->user)->create(['client_id' => $client->id]);

    asClient($client);

    $this->get(route('portal.tour', $project))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->where('model', null));
});

test('a client cannot tour a house that is not theirs', function () {
    $client = Client::factory()->create();
    $other = Client::factory()->create();
    $theirs = Project::factory()->for($other->user)->withSampleResidence()->create([
        'client_id' => $other->id,
    ]);

    asClient($client);

    $this->get(route('portal.tour', $theirs))->assertNotFound();
});

test('the tour is out of reach without a number', function () {
    $project = Project::factory()->create();

    $this->get(route('portal.tour', $project))->assertRedirect(route('portal.enter'));
});

test('a client comments on their own drawing', function () {
    $client = Client::factory()->create();
    $project = Project::factory()->for($client->user)->create(['client_id' => $client->id]);

    asClient($client);

    $this->post(route('portal.comments.store'), [
        'project_id' => $project->id,
        'body' => 'Could the kitchen window be wider?',
    ])->assertRedirect();

    expect(ClientComment::query()->count())->toBe(1);

    $comment = ClientComment::query()->sole();

    expect($comment->client_id)->toBe($client->id)
        ->and($comment->project_id)->toBe($project->id)
        ->and($comment->body)->toBe('Could the kitchen window be wider?');
});

test('a client cannot comment on a drawing that is not theirs', function () {
    $client = Client::factory()->create();
    $other = Client::factory()->create();
    $theirs = Project::factory()->for($other->user)->create(['client_id' => $other->id]);

    asClient($client);

    $this->post(route('portal.comments.store'), [
        'project_id' => $theirs->id,
        'body' => 'Not my house.',
    ])->assertSessionHasErrors('project_id');

    expect(ClientComment::query()->count())->toBe(0);
});

test('a comment is credited to the session, not to whatever the request claims', function () {
    $client = Client::factory()->create();
    $other = Client::factory()->create();
    $project = Project::factory()->for($client->user)->create(['client_id' => $client->id]);

    asClient($client);

    $this->post(route('portal.comments.store'), [
        'project_id' => $project->id,
        'body' => 'Mine.',
        'client_id' => $other->id,
    ])->assertRedirect();

    expect(ClientComment::query()->sole()->client_id)->toBe($client->id);
});

test('an empty comment is refused', function () {
    $client = Client::factory()->create();
    $project = Project::factory()->for($client->user)->create(['client_id' => $client->id]);

    asClient($client);

    $this->post(route('portal.comments.store'), ['project_id' => $project->id, 'body' => ''])
        ->assertSessionHasErrors('body');
});

test('comments come back on the client\'s next visit', function () {
    $client = Client::factory()->create();
    $project = Project::factory()->for($client->user)->create(['client_id' => $client->id]);
    ClientComment::factory()->create([
        'client_id' => $client->id,
        'project_id' => $project->id,
        'body' => 'Could the kitchen window be wider?',
    ]);

    asClient($client);

    $this->get(route('portal.show'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->has('drawings.0.comments', 1)
            ->where('drawings.0.comments.0.body', 'Could the kitchen window be wider?')
        );
});

test('signing out closes the portal', function () {
    $client = Client::factory()->create();

    asClient($client);

    $this->post(route('portal.leave'))->assertRedirect(route('portal.enter'));

    $this->get(route('portal.show'))->assertRedirect(route('portal.enter'));
});

test('a session for a removed client stops working at once', function () {
    $client = Client::factory()->create();

    asClient($client);

    $client->delete();

    $this->get(route('portal.show'))->assertRedirect(route('portal.enter'));
});

test('a stale session lands back on the number pad rather than bouncing', function () {
    $client = Client::factory()->create();

    asClient($client);

    $client->delete();

    // The pad sends a session that looks signed in on to the progress page,
    // and the door there clears it — so this settles rather than looping.
    $this->followingRedirects()
        ->get(route('portal.enter'))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->component('portal/enter'));
});

test('looking in is recorded, and not on every request', function () {
    $client = Client::factory()->create();

    asClient($client);

    $this->get(route('portal.show'))->assertOk();

    $first = $client->refresh()->portal_seen_at;

    expect($first)->not->toBeNull();

    $this->get(route('portal.show'))->assertOk();

    expect($client->refresh()->portal_seen_at->equalTo($first))->toBeTrue();
});

test('the studio sees the credentials to read out', function () {
    $user = User::factory()->create();
    $client = Client::factory()->for($user)->create(['name' => 'Margaret Chen']);

    $this->actingAs($user)
        ->get(route('clients.index'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('clients.0.portal_username', 'margaret-chen')
            ->where('clients.0.portal_number', $client->formattedPortalNumber())
            ->where('clients.0.portal_url', route('portal.enter'))
        );
});

test('the studio sees what the client said', function () {
    $user = User::factory()->create();
    $client = Client::factory()->for($user)->create();
    $project = Project::factory()->for($user)->create(['client_id' => $client->id]);
    ClientComment::factory()->create([
        'client_id' => $client->id,
        'project_id' => $project->id,
        'body' => 'Could the kitchen window be wider?',
    ]);

    $this->actingAs($user)
        ->get(route('clients.index'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('clients.0.projects.0.comments.0.body', 'Could the kitchen window be wider?')
        );
});

test('a new number retires the old one', function () {
    $user = User::factory()->create();
    $client = Client::factory()->for($user)->create();
    $old = $client->portal_number;

    $this->actingAs($user)
        ->post(route('clients.portal-number.reissue', $client))
        ->assertRedirect();

    expect($client->refresh()->portal_number)->not->toBe($old);

    $this->post(route('portal.open'), ['number' => $old])
        ->assertSessionHasErrors('number');
});

test('only the client\'s own studio can issue them a new number', function () {
    $client = Client::factory()->create();
    $outsider = User::factory()->create();
    $old = $client->portal_number;

    $this->actingAs($outsider)
        ->post(route('clients.portal-number.reissue', $client))
        ->assertForbidden();

    expect($client->refresh()->portal_number)->toBe($old);
});
