<?php

use App\Models\Note;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Inertia\Testing\AssertableInertia;

test('guests are redirected away from the notebook', function () {
    $this->get(route('notes.index'))->assertRedirect(route('login'));
});

test('the notebook lists only notes the user can read', function () {
    $user = User::factory()->create();
    Note::factory()->for($user)->create(['title' => 'Site visit']);
    Note::factory()->create(['title' => 'Someone else’s note']);

    $this->actingAs($user)
        ->get(route('notes.index'))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('notes/index')
            ->has('notes', 1)
            ->where('notes.0.title', 'Site visit')
        );
});

test('everyone in an organization reads the same notebook', function () {
    $organization = Organization::factory()->create();
    $author = User::factory()->for($organization)->create(['name' => 'Margaret']);
    $colleague = User::factory()->for($organization)->create();

    Note::factory()->for($author)->create(['title' => 'Shared note']);

    $this->actingAs($colleague)
        ->get(route('notes.index'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->has('notes', 1)
            ->where('notes.0.title', 'Shared note')
            ->where('notes.0.author', 'Margaret')
        );
});

test('pinned notes are read first', function () {
    $user = User::factory()->create();
    Note::factory()->for($user)->create(['title' => 'Ordinary']);
    Note::factory()->for($user)->pinned()->create(['title' => 'Held up top']);

    $this->actingAs($user)
        ->get(route('notes.index'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('notes.0.title', 'Held up top')
            ->where('notes.1.title', 'Ordinary')
        );
});

test('a note can be written with just a heading', function () {
    $user = User::factory()->create();

    $this->actingAs($user)
        ->post(route('notes.store'), ['title' => 'Ring the engineer'])
        ->assertRedirect();

    expect($user->notes()->sole())
        ->title->toBe('Ring the engineer')
        ->body->toBeNull()
        ->pinned->toBeFalse();
});

test('writing a note requires a heading', function () {
    $this->actingAs(User::factory()->create())
        ->post(route('notes.store'), ['body' => 'No heading given'])
        ->assertSessionHasErrors('title');
});

test('a note can be filed against a drawing the team can see', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create(['name' => 'Laneway House']);

    $this->actingAs($user)
        ->post(route('notes.store'), [
            'title' => 'Ridge height confirmed',
            'project_id' => $project->id,
        ])
        ->assertRedirect();

    expect($user->notes()->sole()->project_id)->toBe($project->id);
});

test('a note cannot be filed against someone else’s drawing', function () {
    $stranger = Project::factory()->create();

    $this->actingAs(User::factory()->create())
        ->post(route('notes.store'), [
            'title' => 'Prying',
            'project_id' => $stranger->id,
        ])
        ->assertSessionHasErrors('project_id');
});

test('a note can be revised', function () {
    $user = User::factory()->create();
    $note = Note::factory()->for($user)->create(['title' => 'Draft']);

    $this->actingAs($user)
        ->put(route('notes.update', $note), [
            'title' => 'Final',
            'body' => 'Decided at the site walk.',
        ])
        ->assertRedirect();

    expect($note->fresh())
        ->title->toBe('Final')
        ->body->toBe('Decided at the site walk.');
});

test('revising a note leaves its pin alone', function () {
    $user = User::factory()->create();
    $note = Note::factory()->for($user)->pinned()->create();

    $this->actingAs($user)
        ->put(route('notes.update', $note), ['title' => 'Reworded'])
        ->assertRedirect();

    expect($note->fresh()->pinned)->toBeTrue();
});

test('pinning is a toggle rather than a value the browser sets', function () {
    $user = User::factory()->create();
    $note = Note::factory()->for($user)->create();

    $this->actingAs($user)->patch(route('notes.pin', $note))->assertRedirect();
    expect($note->fresh()->pinned)->toBeTrue();

    $this->actingAs($user)->patch(route('notes.pin', $note))->assertRedirect();
    expect($note->fresh()->pinned)->toBeFalse();
});

test('a note cannot be touched by anyone outside the studio', function () {
    $note = Note::factory()->create(['title' => 'Untouched']);
    $stranger = User::factory()->create();

    $this->actingAs($stranger)
        ->put(route('notes.update', $note), ['title' => 'Vandalised'])
        ->assertForbidden();

    $this->actingAs($stranger)
        ->patch(route('notes.pin', $note))
        ->assertForbidden();

    $this->actingAs($stranger)
        ->delete(route('notes.destroy', $note))
        ->assertForbidden();

    expect($note->fresh()->title)->toBe('Untouched');
});

test('a note can be torn out', function () {
    $user = User::factory()->create();
    $note = Note::factory()->for($user)->create();

    $this->actingAs($user)
        ->delete(route('notes.destroy', $note))
        ->assertRedirect();

    expect(Note::query()->count())->toBe(0);
});

test('deleting a drawing leaves its notes behind, unfiled', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();
    $note = Note::factory()->for($user)->create(['project_id' => $project->id]);

    $project->delete();

    expect($note->fresh())->not->toBeNull()
        ->and($note->fresh()->project_id)->toBeNull();
});
