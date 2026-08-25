<?php

use App\Mail\OrganizationInvitationMail;
use App\Models\Organization;
use App\Models\OrganizationInvitation;
use App\Models\User;
use Illuminate\Support\Facades\Mail;
use Inertia\Testing\AssertableInertia;

beforeEach(function () {
    Mail::fake();
});

/*
|--------------------------------------------------------------------------
| Sending
|--------------------------------------------------------------------------
*/

test('the head invites someone by email', function () {
    $organization = Organization::factory()->create();

    $this->actingAs($organization->owner)
        ->post(route('organization.invitations.store'), ['email' => 'sam@studio.com'])
        ->assertRedirect();

    $invitation = OrganizationInvitation::query()->sole();

    expect($invitation->email)->toBe('sam@studio.com')
        ->and($invitation->organization_id)->toBe($organization->id)
        ->and($invitation->invited_by)->toBe($organization->owner_id)
        ->and($invitation->accepted_at)->toBeNull()
        ->and($invitation->token)->not->toBeEmpty();

    Mail::assertSent(
        OrganizationInvitationMail::class,
        fn (OrganizationInvitationMail $mail): bool => $mail->hasTo('sam@studio.com')
            && $mail->invitation->is($invitation)
    );
});

test('the invitation email says who invited them, where, and how to accept', function () {
    $organization = Organization::factory()->create(['name' => 'Ridgeway Architects']);
    $organization->owner->forceFill(['name' => 'Shane'])->save();

    $invitation = OrganizationInvitation::factory()->for($organization)->create();

    $rendered = (new OrganizationInvitationMail($invitation))->render();

    expect($rendered)->toContain('Ridgeway Architects')
        ->and($rendered)->toContain('Shane')
        ->and($rendered)->toContain(e($invitation->url()))
        ->and($rendered)->toContain('Accept invitation');

    expect((new OrganizationInvitationMail($invitation))->envelope()->subject)
        ->toBe('Shane invited you to Ridgeway Architects');
});

test('the address is stored in lower case so matching is not case sensitive', function () {
    $organization = Organization::factory()->create();

    $this->actingAs($organization->owner)
        ->post(route('organization.invitations.store'), ['email' => '  Sam@Studio.COM ']);

    expect(OrganizationInvitation::query()->sole()->email)->toBe('sam@studio.com');
});

test('an invitation needs a real email address', function () {
    $organization = Organization::factory()->create();

    $this->actingAs($organization->owner)
        ->post(route('organization.invitations.store'), [])
        ->assertSessionHasErrors('email');

    $this->actingAs($organization->owner)
        ->post(route('organization.invitations.store'), ['email' => 'not-an-address'])
        ->assertSessionHasErrors('email');

    Mail::assertNothingSent();
});

test('someone already in the organization cannot be invited again', function () {
    $organization = Organization::factory()->create();
    User::factory()->create([
        'organization_id' => $organization->id,
        'email' => 'sam@studio.com',
    ]);

    $this->actingAs($organization->owner)
        ->post(route('organization.invitations.store'), ['email' => 'SAM@studio.com'])
        ->assertSessionHasErrors('email');

    expect(OrganizationInvitation::query()->count())->toBe(0);
});

test('inviting the same address twice refreshes the invitation rather than duplicating it', function () {
    $organization = Organization::factory()->create();

    $this->actingAs($organization->owner)
        ->post(route('organization.invitations.store'), ['email' => 'sam@studio.com']);

    $first = OrganizationInvitation::query()->sole()->token;

    $this->actingAs($organization->owner)
        ->post(route('organization.invitations.store'), ['email' => 'sam@studio.com']);

    expect(OrganizationInvitation::query()->count())->toBe(1)
        ->and(OrganizationInvitation::query()->sole()->token)->not->toBe($first);

    Mail::assertSent(OrganizationInvitationMail::class, 2);
});

test('an employee cannot invite anyone', function () {
    $organization = Organization::factory()->create();
    $employee = User::factory()->create(['organization_id' => $organization->id]);

    $this->actingAs($employee)
        ->post(route('organization.invitations.store'), ['email' => 'sam@studio.com'])
        ->assertForbidden();

    Mail::assertNothingSent();
});

test('someone with no organization cannot invite anyone', function () {
    $this->actingAs(User::factory()->create())
        ->post(route('organization.invitations.store'), ['email' => 'sam@studio.com'])
        ->assertNotFound();
});

/*
|--------------------------------------------------------------------------
| Managing what has been sent
|--------------------------------------------------------------------------
*/

test('the head resends an invitation with a fresh link', function () {
    $organization = Organization::factory()->create();
    $invitation = OrganizationInvitation::factory()->for($organization)->create();
    $original = $invitation->token;

    $this->actingAs($organization->owner)
        ->post(route('organization.invitations.resend', $invitation))
        ->assertRedirect();

    expect($invitation->fresh()->token)->not->toBe($original);

    Mail::assertSent(OrganizationInvitationMail::class);
});

test('resending an invitation that had gone stale makes it work again', function () {
    $organization = Organization::factory()->create();
    $invitation = OrganizationInvitation::factory()->for($organization)->expired()->create();

    expect($invitation->isPending())->toBeFalse();

    $this->actingAs($organization->owner)
        ->post(route('organization.invitations.resend', $invitation));

    expect($invitation->fresh()->isPending())->toBeTrue();
});

test('the head withdraws an invitation and its link stops working', function () {
    $organization = Organization::factory()->create();
    $invitation = OrganizationInvitation::factory()->for($organization)->create();
    $token = $invitation->token;

    $this->actingAs($organization->owner)
        ->delete(route('organization.invitations.destroy', $invitation))
        ->assertRedirect();

    expect(OrganizationInvitation::query()->count())->toBe(0);

    $employee = User::factory()->create();

    $this->actingAs($employee)->get(route('invitations.accept', $token));

    expect($employee->fresh()->organization_id)->toBeNull();
});

test('an employee cannot resend or withdraw invitations', function () {
    $organization = Organization::factory()->create();
    $employee = User::factory()->create(['organization_id' => $organization->id]);
    $invitation = OrganizationInvitation::factory()->for($organization)->create();

    $this->actingAs($employee)
        ->post(route('organization.invitations.resend', $invitation))
        ->assertForbidden();

    $this->actingAs($employee)
        ->delete(route('organization.invitations.destroy', $invitation))
        ->assertForbidden();
});

test('a head cannot touch another organizations invitations', function () {
    $mine = Organization::factory()->create();
    $theirs = OrganizationInvitation::factory()->create();

    $this->actingAs($mine->owner)
        ->delete(route('organization.invitations.destroy', $theirs))
        ->assertForbidden();

    expect(OrganizationInvitation::query()->count())->toBe(1);
});

/*
|--------------------------------------------------------------------------
| Following the link
|--------------------------------------------------------------------------
*/

test('a logged in user follows the link straight into the organization', function () {
    $organization = Organization::factory()->create();
    $invitation = OrganizationInvitation::factory()->for($organization)->create();
    $employee = User::factory()->create();

    $this->actingAs($employee)
        ->get(route('invitations.accept', $invitation->token))
        ->assertRedirect(route('organization.show'));

    expect($employee->fresh()->organization_id)->toBe($organization->id)
        ->and($invitation->fresh()->accepted_at)->not->toBeNull();
});

test('an invitation can only be used once', function () {
    $invitation = OrganizationInvitation::factory()->create();
    $token = $invitation->token;

    $first = User::factory()->create();
    $this->actingAs($first)->get(route('invitations.accept', $token));

    $second = User::factory()->create();
    $this->actingAs($second)->get(route('invitations.accept', $token));

    expect($second->fresh()->organization_id)->toBeNull();
});

test('an expired link is refused', function () {
    $invitation = OrganizationInvitation::factory()->expired()->create();
    $employee = User::factory()->create();

    $this->actingAs($employee)
        ->get(route('invitations.accept', $invitation->token))
        ->assertRedirect(route('organization.show'));

    expect($employee->fresh()->organization_id)->toBeNull();
});

test('an unknown link sends a guest to log in', function () {
    $this->get(route('invitations.accept', 'nonsense'))
        ->assertRedirect(route('login'));
});

test('a member of another organization is not moved by following a link', function () {
    $mine = Organization::factory()->create();
    $employee = User::factory()->create(['organization_id' => $mine->id]);
    $invitation = OrganizationInvitation::factory()->create();

    $this->actingAs($employee)
        ->get(route('invitations.accept', $invitation->token))
        ->assertRedirect(route('organization.show'));

    expect($employee->fresh()->organization_id)->toBe($mine->id)
        ->and($invitation->fresh()->accepted_at)->toBeNull();
});

test('a guest following the link is sent to register and joins on sign up', function () {
    $organization = Organization::factory()->create(['name' => 'Ridgeway']);
    $invitation = OrganizationInvitation::factory()
        ->for($organization)
        ->create(['email' => 'sam@studio.com']);

    $this->get(route('invitations.accept', $invitation->token))
        ->assertRedirect(route('register'));

    expect(session('invitation.token'))->toBe($invitation->token)
        ->and(session('invitation.email'))->toBe('sam@studio.com')
        ->and(session('invitation.organization'))->toBe('Ridgeway');

    $this->get(route('register'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('invitation.email', 'sam@studio.com')
            ->where('invitation.organization', 'Ridgeway')
        );

    $this->post(route('register.store'), [
        'name' => 'Sam Carter',
        'email' => 'sam@studio.com',
        'password' => 'drafting-table-98',
        'password_confirmation' => 'drafting-table-98',
    ]);

    $sam = User::query()->where('email', 'sam@studio.com')->sole();

    expect($sam->organization_id)->toBe($organization->id)
        ->and($invitation->fresh()->accepted_at)->not->toBeNull()
        ->and(session('invitation'))->toBeNull();
});

test('signing up without an invitation leaves the user on their own', function () {
    $this->post(route('register.store'), [
        'name' => 'Solo Drafter',
        'email' => 'solo@studio.com',
        'password' => 'drafting-table-98',
        'password_confirmation' => 'drafting-table-98',
    ]);

    expect(User::query()->where('email', 'solo@studio.com')->sole()->organization_id)->toBeNull();
});

/*
|--------------------------------------------------------------------------
| The organization page
|--------------------------------------------------------------------------
*/

test('the head sees what is still outstanding, complete with a link to copy', function () {
    $organization = Organization::factory()->create();
    $invitation = OrganizationInvitation::factory()
        ->for($organization)
        ->create(['email' => 'sam@studio.com']);

    OrganizationInvitation::factory()->for($organization)->expired()->create();

    $this->actingAs($organization->owner)
        ->get(route('organization.show'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            // The stale one is left out.
            ->has('invitations', 1)
            ->where('invitations.0.email', 'sam@studio.com')
            ->where('invitations.0.url', $invitation->url())
            ->where('invitations.0.inviter', $organization->owner->name)
        );
});

test('an employee is not shown the outstanding invitations', function () {
    $organization = Organization::factory()->create();
    $employee = User::factory()->create(['organization_id' => $organization->id]);
    OrganizationInvitation::factory()->for($organization)->create();

    $this->actingAs($employee)
        ->get(route('organization.show'))
        ->assertInertia(fn (AssertableInertia $page) => $page->has('invitations', 0));
});

test('a user with no organization sees the invitations addressed to them', function () {
    $organization = Organization::factory()->create(['name' => 'Ridgeway']);
    $invited = User::factory()->create(['email' => 'Sam@Studio.com']);

    OrganizationInvitation::factory()
        ->for($organization)
        ->create(['email' => 'sam@studio.com']);

    // Somebody else's invitation, and one that has gone stale.
    OrganizationInvitation::factory()->create(['email' => 'other@studio.com']);
    OrganizationInvitation::factory()->expired()->create(['email' => 'sam@studio.com']);

    $this->actingAs($invited)
        ->get(route('organization.show'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->has('receivedInvitations', 1)
            ->where('receivedInvitations.0.organization', 'Ridgeway')
            ->where('receivedInvitations.0.inviter', $organization->owner->name)
        );
});

test('accepting from the page joins the organization', function () {
    $organization = Organization::factory()->create();
    $invited = User::factory()->create(['email' => 'sam@studio.com']);
    $invitation = OrganizationInvitation::factory()
        ->for($organization)
        ->create(['email' => 'sam@studio.com']);

    $this->actingAs($invited)
        ->post(route('invitations.claim', $invitation))
        ->assertRedirect(route('organization.show'));

    expect($invited->fresh()->organization_id)->toBe($organization->id);
});

test('declining from the page throws the invitation away', function () {
    $invited = User::factory()->create(['email' => 'sam@studio.com']);
    $invitation = OrganizationInvitation::factory()->create(['email' => 'sam@studio.com']);

    $this->actingAs($invited)
        ->delete(route('invitations.decline', $invitation))
        ->assertRedirect();

    expect(OrganizationInvitation::query()->count())->toBe(0)
        ->and($invited->fresh()->organization_id)->toBeNull();
});

test('an invitation addressed to someone else cannot be accepted or declined', function () {
    $stranger = User::factory()->create(['email' => 'stranger@studio.com']);
    $invitation = OrganizationInvitation::factory()->create(['email' => 'sam@studio.com']);

    $this->actingAs($stranger)
        ->post(route('invitations.claim', $invitation))
        ->assertForbidden();

    $this->actingAs($stranger)
        ->delete(route('invitations.decline', $invitation))
        ->assertForbidden();

    expect($stranger->fresh()->organization_id)->toBeNull()
        ->and(OrganizationInvitation::query()->count())->toBe(1);
});

test('disbanding the organization takes its invitations with it', function () {
    $organization = Organization::factory()->create();
    OrganizationInvitation::factory()->for($organization)->create();

    $this->actingAs($organization->owner)->delete(route('organization.destroy'));

    expect(OrganizationInvitation::query()->count())->toBe(0);
});

test('invitation links are built on https behind a TLS terminating proxy', function () {
    $organization = Organization::factory()->create();
    OrganizationInvitation::factory()->for($organization)->create();

    // How a request arrives on Laravel Cloud: the balancer has already handled
    // TLS and hands the app plain HTTP on an http:// URL, saying what the
    // client actually used in this header. Without trusted proxies the link
    // below goes out as http:// and every invitation email is wrong.
    $this->actingAs($organization->owner)
        ->get('http://axon.test/organization', ['X-Forwarded-Proto' => 'https'])
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('invitations.0.url', fn (string $url): bool => str_starts_with($url, 'https://'))
        );
});
