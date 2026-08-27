<?php

namespace App\Http\Controllers;

use App\Models\Message;
use App\Models\Organization;
use App\Models\OrganizationInvitation;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

class OrganizationController extends Controller
{
    /**
     * How many chat messages travel with the page. The conversation is a
     * studio noticeboard, not an archive.
     */
    private const MESSAGE_LIMIT = 100;

    /**
     * The organization hub — or the create/join forms when the user has none.
     */
    public function show(Request $request): Response
    {
        $user = $request->user();
        $organization = $user->organization;

        if ($organization === null) {
            return Inertia::render('organization/index', [
                'organization' => null,
                'messages' => [],
                'invitations' => [],
                // Someone has already asked them to join a studio.
                'receivedInvitations' => $user->pendingInvitations()
                    ->with(['organization:id,name', 'inviter:id,name'])
                    ->latest('id')
                    ->get()
                    ->map(fn (OrganizationInvitation $invitation): array => [
                        'id' => $invitation->id,
                        'organization' => $invitation->organization->name,
                        'inviter' => $invitation->inviter?->name,
                        'expires_at' => $invitation->expiresAt()->toIso8601String(),
                    ]),
            ]);
        }

        $isHead = $organization->owner_id === $user->id;

        return Inertia::render('organization/index', [
            'receivedInvitations' => [],
            // Outstanding invitations are the head's business, like the code.
            'invitations' => ! $isHead ? [] : $organization->invitations()
                ->pending()
                ->with('inviter:id,name')
                ->oldest('id')
                ->get()
                ->map(fn (OrganizationInvitation $invitation): array => [
                    'id' => $invitation->id,
                    'email' => $invitation->email,
                    'url' => $invitation->url(),
                    'inviter' => $invitation->inviter?->name,
                    'expires_at' => $invitation->expiresAt()->toIso8601String(),
                ]),
            'organization' => [
                'id' => $organization->id,
                'name' => $organization->name,
                'is_head' => $isHead,
                // The code is the key to everything, so only the head sees it.
                'join_code' => $isHead ? $organization->join_code : null,
                'members' => $organization->members()
                    ->orderBy('name')
                    ->get()
                    ->map(fn (User $member): array => [
                        'id' => $member->id,
                        'name' => $member->name,
                        'email' => $member->email,
                        'is_head' => $member->id === $organization->owner_id,
                        'is_me' => $member->id === $user->id,
                    ]),
            ],
            'messages' => $organization->messages()
                ->channel()
                ->with('user:id,name')
                ->latest('id')
                ->limit(self::MESSAGE_LIMIT)
                ->get()
                ->reverse()
                ->values()
                ->map(fn (Message $message): array => [
                    'id' => $message->id,
                    'body' => $message->body,
                    'author' => $message->user?->name ?? 'Former member',
                    'mine' => $message->user_id === $user->id,
                    'created_at' => $message->created_at?->toIso8601String(),
                ]),
        ]);
    }

    /**
     * Start an organization, with the founder as its head.
     */
    public function store(Request $request): RedirectResponse
    {
        $user = $request->user();

        if ($user->organization_id !== null) {
            throw ValidationException::withMessages([
                'name' => __('You are already in an organization.'),
            ]);
        }

        $validated = $request->validate([
            'name' => ['required', 'string', 'max:120'],
        ]);

        $organization = new Organization($validated);
        // Ownership and the code are set here rather than mass assigned, so a
        // crafted request can never nominate another owner or choose a code.
        $organization->forceFill([
            'owner_id' => $user->id,
            'join_code' => Organization::generateJoinCode(),
        ])->save();

        $user->organization()->associate($organization)->save();

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Organization created.')]);

        return back();
    }

    /**
     * Rename the organization. The head calls it whatever they like.
     */
    public function update(Request $request): RedirectResponse
    {
        $organization = $this->headedOrganization($request);

        $organization->update($request->validate([
            'name' => ['required', 'string', 'max:120'],
        ]));

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Organization renamed.')]);

        return back();
    }

    /**
     * Join an organization with the code the head handed out.
     */
    public function join(Request $request): RedirectResponse
    {
        $user = $request->user();

        if ($user->organization_id !== null) {
            throw ValidationException::withMessages([
                'code' => __('Leave your current organization first.'),
            ]);
        }

        $validated = $request->validate([
            'code' => ['required', 'string', 'max:40'],
        ]);

        $organization = Organization::query()
            ->where('join_code', Organization::normaliseJoinCode($validated['code']))
            ->first();

        if ($organization === null) {
            throw ValidationException::withMessages([
                'code' => __('That code does not match any organization.'),
            ]);
        }

        $user->organization()->associate($organization)->save();

        Inertia::flash('toast', [
            'type' => 'success',
            'message' => __('Welcome to :name.', ['name' => $organization->name]),
        ]);

        return back();
    }

    /**
     * Hand out a fresh code, cutting off the old one.
     */
    public function regenerateCode(Request $request): RedirectResponse
    {
        $organization = $this->headedOrganization($request);

        $organization->forceFill(['join_code' => Organization::generateJoinCode()])->save();

        Inertia::flash('toast', [
            'type' => 'success',
            'message' => __('New join code issued — the old one no longer works.'),
        ]);

        return back();
    }

    /**
     * A member steps out. The head cannot leave — they disband instead.
     */
    public function leave(Request $request): RedirectResponse
    {
        $user = $request->user();

        abort_if($user->organization_id === null, 404);
        abort_if($user->isOrganizationHead(), 403, 'The head disbands the organization rather than leaving it.');

        $user->organization()->dissociate()->save();

        return to_route('organization.show');
    }

    /**
     * The head closes the organization. Everyone keeps their own work; the
     * shared view and the conversation go.
     */
    public function destroy(Request $request): RedirectResponse
    {
        $organization = $this->headedOrganization($request);

        $organization->delete();

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Organization disbanded.')]);

        return to_route('organization.show');
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
