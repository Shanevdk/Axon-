<?php

use App\Models\LibraryItem;
use App\Models\Organization;
use App\Models\User;
use Database\Factories\LibraryItemFactory;
use Inertia\Testing\AssertableInertia;

/**
 * A complete, valid save as the browser composes one.
 */
function librarySave(array $overrides = []): array
{
    return array_replace_recursive([
        'name' => 'Reading Chair',
        'category' => 'Furniture',
        'kind' => 'imported',
        'thumbnail' => 'data:image/svg+xml;charset=utf-8,'.rawurlencode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>'),
        'payload' => LibraryItemFactory::payload(),
    ], $overrides);
}

test('guests are turned away from the library', function () {
    $this->get(route('library.index'))->assertRedirect(route('login'));
    $this->get(route('library.feed'))->assertRedirect(route('login'));
});

test('the shelf lists the team’s items without their payloads', function () {
    $user = User::factory()->create();
    LibraryItem::factory()->for($user)->create(['name' => 'Couch']);
    LibraryItem::factory()->create(['name' => 'Someone Else’s Couch']);

    $this->actingAs($user)
        ->get(route('library.index'))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('library/index')
            ->has('items', 1)
            ->where('items.0.name', 'Couch')
            ->missing('items.0.payload')
        );
});

test('an organization shares one shelf', function () {
    $organization = Organization::factory()->create();
    $author = User::factory()->for($organization)->create(['name' => 'Margaret']);
    $colleague = User::factory()->for($organization)->create();

    LibraryItem::factory()->for($author)->create(['name' => 'Shared Couch']);

    $this->actingAs($colleague)
        ->get(route('library.feed'))
        ->assertOk()
        ->assertJsonPath('items.0.name', 'Shared Couch')
        ->assertJsonPath('items.0.author', 'Margaret');
});

test('an item can be saved to the shelf', function () {
    $user = User::factory()->create();

    $this->actingAs($user)
        ->post(route('library.store'), librarySave())
        ->assertRedirect(route('library.index'));

    expect($user->libraryItems()->sole())
        ->name->toBe('Reading Chair')
        ->triangles->toBe(1)
        ->kind->toBe('imported');
});

test('a mesh of partial triangles is refused', function () {
    $save = librarySave();
    $save['payload']['vertices'] = [0, 0, 0, 1, 1, 1]; // two points, no triangle

    $this->actingAs(User::factory()->create())
        ->post(route('library.store'), $save)
        ->assertSessionHasErrors('payload.vertices');
});

test('a mesh past the triangle ceiling is refused', function () {
    $save = librarySave([
        'payload' => ['triangleCount' => LibraryItem::MAX_TRIANGLES + 1],
    ]);

    $this->actingAs(User::factory()->create())
        ->post(route('library.store'), $save)
        ->assertSessionHasErrors('payload.triangleCount');
});

test('a lying triangle count is refused', function () {
    $save = librarySave(['payload' => ['triangleCount' => 7]]);

    $this->actingAs(User::factory()->create())
        ->post(route('library.store'), $save)
        ->assertSessionHasErrors('payload.triangleCount');
});

test('a thumbnail that is not an SVG data URL is refused', function () {
    $this->actingAs(User::factory()->create())
        ->post(route('library.store'), librarySave(['thumbnail' => 'https://example.com/x.png']))
        ->assertSessionHasErrors('thumbnail');
});

test('the payload endpoint hands over the geometry for placing', function () {
    $user = User::factory()->create();
    $item = LibraryItem::factory()->for($user)->create();

    $this->actingAs($user)
        ->get(route('library.payload', $item))
        ->assertOk()
        ->assertJsonPath('payload.triangleCount', 1)
        ->assertJsonCount(9, 'payload.vertices');
});

test('a stranger can neither fetch, rename nor delete an item', function () {
    $item = LibraryItem::factory()->create(['name' => 'Untouched']);
    $stranger = User::factory()->create();

    $this->actingAs($stranger)->get(route('library.payload', $item))->assertForbidden();

    $this->actingAs($stranger)
        ->put(route('library.update', $item), librarySave(['name' => 'Stolen']))
        ->assertForbidden();

    $this->actingAs($stranger)->delete(route('library.destroy', $item))->assertForbidden();

    expect($item->fresh()->name)->toBe('Untouched');
});

test('resaving from the designer replaces the geometry', function () {
    $user = User::factory()->create();
    $item = LibraryItem::factory()->for($user)->designed()->create(['name' => 'Couch']);

    $this->actingAs($user)
        ->put(route('library.update', $item), librarySave([
            'name' => 'Longer Couch',
            'kind' => 'designed',
        ]))
        ->assertRedirect(route('library.index'));

    expect($item->fresh())
        ->name->toBe('Longer Couch')
        ->kind->toBe('designed');
});

test('an item can be taken off the shelf', function () {
    $user = User::factory()->create();
    $item = LibraryItem::factory()->for($user)->create();

    $this->actingAs($user)
        ->delete(route('library.destroy', $item))
        ->assertRedirect();

    expect(LibraryItem::query()->count())->toBe(0);
});

/* -------------------------------------------------------------- designer */

test('the designer opens blank', function () {
    $this->actingAs(User::factory()->create())
        ->get(route('library.designer'))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('library/designer')
            ->where('editing', null)
        );
});

test('the designer reopens a designed item with its parts', function () {
    $user = User::factory()->create();
    $item = LibraryItem::factory()->for($user)->designed()->create(['name' => 'Couch']);

    $this->actingAs($user)
        ->get(route('library.designer', ['item' => $item->id]))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('editing.name', 'Couch')
            ->where('editing.parts.0.name', 'Seat')
        );
});

test('the designer refuses an imported item — there are no parts to edit', function () {
    $user = User::factory()->create();
    $item = LibraryItem::factory()->for($user)->create();

    $this->actingAs($user)
        ->get(route('library.designer', ['item' => $item->id]))
        ->assertNotFound();
});

test('the designer refuses someone else’s item', function () {
    $item = LibraryItem::factory()->designed()->create();

    $this->actingAs(User::factory()->create())
        ->get(route('library.designer', ['item' => $item->id]))
        ->assertForbidden();
});
