<?php

namespace App\Http\Controllers;

use App\Models\Message;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

class ChatController extends Controller
{
    /**
     * How many chat messages travel with the page. The conversation is a
     * studio noticeboard, not an archive.
     */
    private const MESSAGE_LIMIT = 200;

    /**
     * The chat page: the conversation beside everyone's presence, the way
     * Teams puts the people next to the talk. `?with=` opens the private
     * conversation with that colleague instead of the team channel.
     */
    public function index(Request $request): Response
    {
        $user = $request->user();
        $organization = $user->organization;

        if ($organization === null) {
            return Inertia::render('chat/index', [
                'organization' => null,
                'members' => [],
                'conversation' => [],
                'with' => null,
                'me' => [
                    'presence' => $user->presence,
                    'message' => $user->presence_message,
                ],
            ]);
        }

        $partner = $this->conversationPartner($request, $organization);

        if ($partner !== null) {
            // Opening the conversation is reading it.
            $organization->messages()
                ->where('user_id', $partner->id)
                ->where('recipient_id', $user->id)
                ->whereNull('read_at')
                ->update(['read_at' => now()]);
        }

        $unread = Message::query()
            ->where('organization_id', $organization->id)
            ->where('recipient_id', $user->id)
            ->whereNull('read_at')
            ->selectRaw('user_id, count(*) as total')
            ->groupBy('user_id')
            ->pluck('total', 'user_id');

        return Inertia::render('chat/index', [
            'organization' => [
                'name' => $organization->name,
            ],
            'with' => $partner?->id,
            'members' => $organization->members()
                ->orderBy('name')
                ->get()
                ->map(fn (User $member): array => [
                    'id' => $member->id,
                    'name' => $member->name,
                    'email' => $member->email,
                    'is_head' => $member->id === $organization->owner_id,
                    'is_me' => $member->id === $user->id,
                    'presence' => $member->currentPresence(),
                    'last_active_at' => $member->last_active_at?->toIso8601String(),
                    'unread' => (int) ($unread[$member->id] ?? 0),
                ]),
            'conversation' => $this->conversation($organization, $user, $partner),
            'me' => [
                'presence' => $user->presence,
                'message' => $user->presence_message,
            ],
        ]);
    }

    /**
     * Pin a status on the caller, or hand it back to automatic.
     */
    public function updateStatus(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'presence' => ['required', 'string', Rule::in(['auto', ...User::MANUAL_PRESENCES])],
            'message' => ['nullable', 'string', 'max:120'],
        ]);

        $request->user()->forceFill([
            'presence' => $validated['presence'] === 'auto' ? null : $validated['presence'],
            'presence_message' => $validated['message'] ?? null,
        ])->saveQuietly();

        return back();
    }

    /**
     * The colleague `?with=` points at, when it points at a real one.
     * Anything else — themselves, a stranger, nothing — reads as the channel.
     */
    private function conversationPartner(Request $request, Organization $organization): ?User
    {
        $withId = $request->integer('with');

        if ($withId === 0 || $withId === $request->user()->id) {
            return null;
        }

        return $organization->members()->find($withId);
    }

    /**
     * The messages of whichever conversation is open: the team channel, or
     * the private thread with one colleague.
     *
     * @return Collection<int, array<string, mixed>>
     */
    private function conversation(Organization $organization, User $user, ?User $partner)
    {
        return $organization->messages()
            ->when(
                $partner === null,
                fn (Builder $query) => $query->channel(),
                fn (Builder $query) => $query->between($user, $partner),
            )
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
                'author_id' => $message->user_id,
                'mine' => $message->user_id === $user->id,
                'created_at' => $message->created_at?->toIso8601String(),
            ]);
    }
}
