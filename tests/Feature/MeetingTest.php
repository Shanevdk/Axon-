<?php

use App\Models\Client;
use App\Models\Meeting;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Illuminate\Support\Carbon;
use Inertia\Testing\AssertableInertia;

test('guests are redirected away from the calendar', function () {
    $this->get(route('calendar'))->assertRedirect(route('login'));
});

test('the calendar opens on this month', function () {
    Carbon::setTestNow('2026-05-14 08:00:00');

    $this->actingAs(User::factory()->create())
        ->get(route('calendar'))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('calendar/index')
            ->where('month.value', '2026-05')
            ->where('month.label', 'May 2026')
            ->where('month.today', '2026-05-14')
        );
});

test('the month grid runs whole weeks from Sunday and marks the days either side', function () {
    Carbon::setTestNow('2026-05-14 08:00:00');

    $this->actingAs(User::factory()->create())
        ->get(route('calendar', ['month' => '2026-05']))
        ->assertInertia(fn (AssertableInertia $page) => $page
            // 1 May 2026 is a Friday, so the grid opens on Sunday 26 April.
            ->where('month.first', '2026-04-26')
            ->where('month.last', '2026-06-06')
            ->where('month.weeks.0.0.date', '2026-04-26')
            ->where('month.weeks.0.0.inMonth', false)
            ->where('month.weeks.0.5.date', '2026-05-01')
            ->where('month.weeks.0.5.inMonth', true)
        );
});

test('a nonsense month falls back to this one rather than erroring', function () {
    Carbon::setTestNow('2026-05-14 08:00:00');

    $this->actingAs(User::factory()->create())
        ->get(route('calendar', ['month' => 'not-a-month']))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->where('month.value', '2026-05'));

    $this->actingAs(User::factory()->create())
        ->get(route('calendar', ['month' => '2026-13']))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->where('month.value', '2026-05'));
});

test('the calendar shows only the meetings falling in the month on screen', function () {
    $user = User::factory()->create();
    Meeting::factory()->for($user)->on('2026-05-20')->create(['title' => 'In May']);
    Meeting::factory()->for($user)->on('2026-08-20')->create(['title' => 'In August']);

    $this->actingAs($user)
        ->get(route('calendar', ['month' => '2026-05']))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->has('meetings', 1)
            ->where('meetings.0.title', 'In May')
        );
});

test('the diary is shared across an organization', function () {
    $organization = Organization::factory()->create();
    $author = User::factory()->for($organization)->create(['name' => 'Margaret']);
    $colleague = User::factory()->for($organization)->create();

    Meeting::factory()->for($author)->on('2026-05-20')->create(['title' => 'Design review']);

    $this->actingAs($colleague)
        ->get(route('calendar', ['month' => '2026-05']))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->has('meetings', 1)
            ->where('meetings.0.title', 'Design review')
            ->where('meetings.0.author', 'Margaret')
        );
});

test('a meeting keeps the wall-clock time it was given', function () {
    $user = User::factory()->create();

    $this->actingAs($user)
        ->post(route('meetings.store'), [
            'title' => 'Client presentation',
            'date' => '2026-05-20',
            'start_time' => '15:00',
            'end_time' => '16:30',
        ])
        ->assertRedirect();

    $meeting = $user->meetings()->sole();

    expect($meeting->starts_at->format('Y-m-d H:i'))->toBe('2026-05-20 15:00')
        ->and($meeting->ends_at->format('Y-m-d H:i'))->toBe('2026-05-20 16:30')
        ->and($meeting->minutes())->toBe(90);
});

test('the calendar hands the browser split times rather than a timestamp', function () {
    $user = User::factory()->create();
    Meeting::factory()->for($user)->on('2026-05-20', '15:00')->create();

    $this->actingAs($user)
        ->get(route('calendar', ['month' => '2026-05']))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('meetings.0.date', '2026-05-20')
            ->where('meetings.0.start_time', '15:00')
            ->where('meetings.0.end_time', '16:00')
        );
});

test('a meeting with no end time runs the default hour', function () {
    $user = User::factory()->create();

    $this->actingAs($user)
        ->post(route('meetings.store'), [
            'title' => 'Quick call',
            'date' => '2026-05-20',
            'start_time' => '09:00',
        ])
        ->assertRedirect();

    expect($user->meetings()->sole())
        ->ends_at->toBeNull()
        ->minutes()->toBe(Meeting::DEFAULT_MINUTES);
});

test('booking requires a title, a day and a start time', function () {
    $this->actingAs(User::factory()->create())
        ->post(route('meetings.store'), [])
        ->assertSessionHasErrors(['title', 'date', 'start_time']);
});

test('a meeting cannot end before it starts', function () {
    $this->actingAs(User::factory()->create())
        ->post(route('meetings.store'), [
            'title' => 'Backwards',
            'date' => '2026-05-20',
            'start_time' => '15:00',
            'end_time' => '14:00',
        ])
        ->assertSessionHasErrors('end_time');
});

test('a meeting cannot be attached to another studio’s client or drawing', function () {
    $stranger = User::factory()->create();
    $client = Client::factory()->for($stranger)->create();
    $project = Project::factory()->for($stranger)->create();

    $this->actingAs(User::factory()->create())
        ->post(route('meetings.store'), [
            'title' => 'Prying',
            'date' => '2026-05-20',
            'start_time' => '09:00',
            'client_id' => $client->id,
            'project_id' => $project->id,
        ])
        ->assertSessionHasErrors(['client_id', 'project_id']);
});

test('a meeting can be moved to another day', function () {
    $user = User::factory()->create();
    $meeting = Meeting::factory()->for($user)->on('2026-05-20', '09:00')->create();

    $this->actingAs($user)
        ->put(route('meetings.update', $meeting), [
            'title' => $meeting->title,
            'date' => '2026-05-27',
            'start_time' => '11:30',
        ])
        ->assertRedirect();

    expect($meeting->fresh()->starts_at->format('Y-m-d H:i'))->toBe('2026-05-27 11:30');
});

test('a meeting cannot be moved or cancelled by another studio', function () {
    $meeting = Meeting::factory()->on('2026-05-20')->create(['title' => 'Untouched']);
    $stranger = User::factory()->create();

    $this->actingAs($stranger)
        ->put(route('meetings.update', $meeting), [
            'title' => 'Hijacked',
            'date' => '2026-05-21',
            'start_time' => '09:00',
        ])
        ->assertForbidden();

    $this->actingAs($stranger)
        ->delete(route('meetings.destroy', $meeting))
        ->assertForbidden();

    expect($meeting->fresh()->title)->toBe('Untouched');
});

test('a meeting can be cancelled', function () {
    $user = User::factory()->create();
    $meeting = Meeting::factory()->for($user)->on('2026-05-20')->create();

    $this->actingAs($user)
        ->delete(route('meetings.destroy', $meeting))
        ->assertRedirect();

    expect(Meeting::query()->count())->toBe(0);
});

test('the agenda rail looks ahead regardless of the month on screen', function () {
    Carbon::setTestNow('2026-05-14 08:00:00');

    $user = User::factory()->create();
    Meeting::factory()->for($user)->on('2026-05-16')->create(['title' => 'Soon']);
    Meeting::factory()->for($user)->on('2026-05-10')->create(['title' => 'Already been']);

    $this->actingAs($user)
        ->get(route('calendar', ['month' => '2026-09']))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->has('meetings', 0)
            ->has('upcoming', 1)
            ->where('upcoming.0.title', 'Soon')
        );
});
