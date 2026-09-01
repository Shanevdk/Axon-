<?php

namespace App\Http\Controllers;

use App\Http\Requests\CreateInvitedUserRequest;
use App\Mail\OrganizationInvitationMail;
use App\Models\Organization;
use App\Models\OrganizationInvitation;
use App\Models\User;
use App\Rules\WorkEmail;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;
use Throwable;

class OrganizationInvitationController extends Controller
{
    /**
     * Invite someone by email. Re-inviting an address simply refreshes the
     * outstanding invitation rather than failing.
     */
    public function store(Request $request): RedirectResponse
    {
        $organization = $this->headedOrganization($request);

        $validated = $request->validate([
            // Inviting a personal address would only produce an account that
            // cannot sign in, so it is refused here rather than later.
            'email' => ['required', 'string', 'email', 'max:255', new WorkEmail],
        ]);

        $email = OrganizationInvitation::normaliseEmail($validated['email']);

        if ($this->alreadyInside($organization, $email)) {
            throw ValidationException::withMessages([
                'email' => __('That person is already in the organization.'),
            ]);
        }

        $invitation = $organization->invitations()->firstOrNew(['email' => $email]);

        $invitation->forceFill([
            'invited_by' => $request->user()->id,
            'token' => OrganizationInvitation::generateToken(),
            'accepted_at' => null,
            // Resetting the timestamp restarts the two week window.
            'created_at' => now(),
        ])->save();

        $this->flashDelivery($invitation, __('Invitation sent to :email.', ['email' => $email]));

        return back();
    }

    /**
     * Send the invitation again, with a fresh link and a fresh two weeks.
     */
    public function resend(Request $request, OrganizationInvitation $invitation): RedirectResponse
    {
        $this->authoriseInvitation($request, $invitation);

        $invitation->forceFill([
            'token' => OrganizationInvitation::generateToken(),
            'accepted_at' => null,
            'created_at' => now(),
        ])->save();

        $this->flashDelivery($invitation, __('Invitation resent to :email.', ['email' => $invitation->email]));

        return back();
    }

    /**
     * Withdraw an invitation. Its link stops working immediately.
     */
    public function destroy(Request $request, OrganizationInvitation $invitation): RedirectResponse
    {
        $this->authoriseInvitation($request, $invitation);

        $invitation->delete();

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Invitation withdrawn.')]);

        return back();
    }

    /**
     * Follow an invitation link. Guests are sent to register first and land
     * back here automatically once they have an account.
     */
    public function accept(Request $request, string $token): RedirectResponse
    {
        $invitation = OrganizationInvitation::query()
            ->where('token', $token)
            ->with('organization')
            ->first();

        if ($invitation === null || ! $invitation->isPending()) {
            return $this->rejectLink($request);
        }

        $user = $request->user();

        if ($user === null) {
            // Nobody signs themselves up, so the link itself is the way in.
            $request->session()->put('invitation', [
                'token' => $invitation->token,
                'email' => $invitation->email,
                'organization' => $invitation->organization->name,
            ]);

            return to_route('invitations.setup');
        }

        return $this->settle($request, $invitation, $user);
    }

    /**
     * The page an invited person lands on: their address is already settled,
     * so all that is left is a name and a password.
     */
    public function setUp(Request $request): Response|RedirectResponse
    {
        $invitation = $this->invitationInSession();

        if ($invitation === null) {
            return $this->rejectLink($request);
        }

        return Inertia::render('auth/set-up', [
            'passwordRules' => Password::defaults()->toPasswordRulesString(),
            'email' => $invitation->email,
            'organization' => $invitation->organization->name,
        ]);
    }

    /**
     * Open the account the invitation was addressed to.
     *
     * The address comes from the invitation rather than the form, so nobody
     * can turn a link addressed to one person into an account for another.
     */
    public function open(CreateInvitedUserRequest $request): RedirectResponse
    {
        $invitation = $this->invitationInSession();

        if ($invitation === null) {
            return $this->rejectLink($request);
        }

        $user = User::create([
            'name' => $request->string('name')->toString(),
            'email' => $invitation->email,
            'password' => $request->string('password')->toString(),
        ]);

        // Invited by name, so the address needs no second proof.
        $user->forceFill(['email_verified_at' => now()])->save();

        $invitation->claim($user);
        $request->session()->forget('invitation');

        Auth::login($user);
        $request->session()->regenerate();

        Inertia::flash('toast', [
            'type' => 'success',
            'message' => __('Welcome to :organization.', [
                'organization' => $invitation->organization->name,
            ]),
        ]);

        return redirect()->intended(route('home'));
    }

    /**
     * The pending invitation the visitor is carrying, if it is still good.
     */
    private function invitationInSession(): ?OrganizationInvitation
    {
        $token = session('invitation.token');

        if (! is_string($token)) {
            return null;
        }

        $invitation = OrganizationInvitation::query()
            ->where('token', $token)
            ->with('organization')
            ->first();

        return $invitation?->isPending() ? $invitation : null;
    }

    /**
     * Accept an invitation waiting on the organization page.
     */
    public function claim(Request $request, OrganizationInvitation $invitation): RedirectResponse
    {
        $user = $request->user();

        abort_unless(
            $invitation->isPending() && $invitation->email === OrganizationInvitation::normaliseEmail($user->email),
            403,
        );

        return $this->settle($request, $invitation, $user);
    }

    /**
     * Turn an invitation down. It disappears from both sides.
     */
    public function decline(Request $request, OrganizationInvitation $invitation): RedirectResponse
    {
        $user = $request->user();

        abort_unless($invitation->email === OrganizationInvitation::normaliseEmail($user->email), 403);

        $invitation->delete();

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Invitation declined.')]);

        return back();
    }

    /**
     * Put the user in the organization, refusing politely when they are
     * already somewhere.
     */
    private function settle(Request $request, OrganizationInvitation $invitation, User $user): RedirectResponse
    {
        if ($user->organization_id === $invitation->organization_id) {
            Inertia::flash('toast', ['type' => 'info', 'message' => __('You are already in this organization.')]);

            return to_route('organization.show');
        }

        if ($user->organization_id !== null) {
            Inertia::flash('toast', [
                'type' => 'error',
                'message' => __('Leave your current organization before accepting this invitation.'),
            ]);

            return to_route('organization.show');
        }

        $invitation->claim($user);
        $request->session()->forget('invitation');

        Inertia::flash('toast', [
            'type' => 'success',
            'message' => __('Welcome to :name.', ['name' => $invitation->organization->name]),
        ]);

        return to_route('organization.show');
    }

    /**
     * A link that has been withdrawn, used up or left too long.
     */
    private function rejectLink(Request $request): RedirectResponse
    {
        Inertia::flash('toast', [
            'type' => 'error',
            'message' => __('That invitation link is no longer valid. Ask for a new one.'),
        ]);

        return $request->user() === null ? to_route('login') : to_route('organization.show');
    }

    /**
     * Try to deliver the invitation, and say so either way. A studio without a
     * working mail server can still copy the link out of the pending list.
     */
    private function flashDelivery(OrganizationInvitation $invitation, string $message): void
    {
        try {
            Mail::to($invitation->email)->send(new OrganizationInvitationMail($invitation));
        } catch (Throwable $exception) {
            Log::warning('Invitation email could not be sent.', [
                'invitation_id' => $invitation->id,
                'exception' => $exception->getMessage(),
            ]);

            Inertia::flash('toast', [
                'type' => 'error',
                'message' => __('Invitation created, but the email could not be sent. Copy the link and send it yourself.'),
            ]);

            return;
        }

        Inertia::flash('toast', ['type' => 'success', 'message' => $message]);
    }

    /**
     * Whether the address belongs to someone already in the organization.
     */
    private function alreadyInside(Organization $organization, string $email): bool
    {
        return $organization->members()
            ->whereRaw('lower(email) = ?', [$email])
            ->exists();
    }

    /**
     * The caller must be the head of the organization the invitation belongs to.
     */
    private function authoriseInvitation(Request $request, OrganizationInvitation $invitation): void
    {
        $organization = $this->headedOrganization($request);

        abort_unless($invitation->organization_id === $organization->id, 403);
    }

    /**
     * The caller's organization, provided they are its head.
     */
    private function headedOrganization(Request $request): Organization
    {
        $organization = $request->user()->organization;

        abort_if($organization === null, 404);
        abort_unless($organization->owner_id === $request->user()->id, 403);

        return $organization;
    }
}
