<?php

namespace App\Http\Controllers;

use App\Actions\Assistant\DraftItemParts;
use App\Actions\Assistant\RunClaudeCode;
use App\Actions\Library\CompileItemParts;
use App\Http\Requests\SaveLibraryItemRequest;
use App\Models\AiConnection;
use App\Models\DesignBoard;
use App\Models\LibraryItem;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;
use Inertia\Inertia;
use Inertia\Response;
use RuntimeException;

class LibraryItemController extends Controller
{
    /**
     * The library shelf.
     *
     * Payloads stay behind — a shelf of couches can carry megabytes of
     * triangles, and the page only needs the pictures.
     */
    public function index(Request $request): Response
    {
        return Inertia::render('library/index', [
            'items' => $this->shelf($request),
        ]);
    }

    /**
     * The same shelf as JSON, for the editor's grab-and-place dialog.
     */
    public function feed(Request $request): JsonResponse
    {
        return response()->json(['items' => $this->shelf($request)]);
    }

    /**
     * One item's geometry, fetched only at the moment of placing or editing.
     */
    public function payload(Request $request, LibraryItem $libraryItem): JsonResponse
    {
        Gate::authorize('view', $libraryItem);

        return response()->json([
            'name' => $libraryItem->name,
            'payload' => $libraryItem->payload,
        ]);
    }

    /**
     * The item designer, blank or reopening a designed item.
     */
    public function designer(Request $request, RunClaudeCode $claude): Response
    {
        $editing = null;

        if ($request->filled('item')) {
            $item = LibraryItem::query()->findOrFail($request->integer('item'));

            Gate::authorize('update', $item);

            // Only a designed item still has parts to edit; an imported file
            // is geometry with no memory of how it was made.
            abort_unless($item->isEditable(), 404);

            $editing = [
                'id' => $item->id,
                'name' => $item->name,
                'category' => $item->category,
                'parts' => $item->payload['parts'] ?? [],
            ];
        }

        return Inertia::render('library/designer', [
            'editing' => $editing,
            // Two separate answers, because they are two separate problems:
            // whether the CLI is on this machine at all, and whether this
            // person has signed in with their own Claude account. Telling
            // somebody to install what they already have helps nobody.
            'claude' => [
                'installed' => $claude->isAvailable(),
                'signedIn' => $request->user()->claudeAccount !== null,
            ],
            // The AI accounts this user has connected — provider and model
            // only. The keys stay on the server, always.
            'connections' => $request->user()
                ->aiConnections()
                ->orderBy('provider')
                ->get()
                ->map(fn (AiConnection $connection): array => [
                    'id' => $connection->id,
                    'provider' => $connection->provider,
                    'label' => AiConnection::PROVIDERS[$connection->provider]['label'],
                    'model' => $connection->modelId(),
                ])
                ->all(),
        ]);
    }

    /**
     * Ask one of the user's connected AIs to draft or revise an item's parts.
     *
     * The reply is held to exactly the rules every other author of parts is
     * held to, then normalised, so whatever the model dreams up arrives in
     * the designer as ordinary, editable parts — or not at all.
     */
    public function draft(Request $request, DraftItemParts $draft): JsonResponse
    {
        $validated = $request->validate([
            'provider' => ['required', 'string'],
            'prompt' => ['required', 'string', 'min:3', 'max:2000'],
            'parts' => ['nullable', 'array', 'max:'.CompileItemParts::MAX_PARTS],
        ]);

        $connection = $request->user()
            ->aiConnections()
            ->where('provider', $validated['provider'])
            ->first();

        if ($connection === null) {
            return response()->json([
                'message' => __('That AI is not connected yet. Add its key first.'),
            ], 422);
        }

        try {
            $drafted = $draft->handle(
                $connection,
                $validated['prompt'],
                $validated['parts'] ?? [],
            );
        } catch (RuntimeException $failure) {
            return response()->json(['message' => $failure->getMessage()], 503);
        }

        $checked = Validator::make(['parts' => $drafted['parts']], CompileItemParts::partRules());

        if ($checked->fails()) {
            return response()->json([
                'message' => __('The model replied with parts the designer cannot build. Ask again.'),
            ], 503);
        }

        return response()->json([
            'name' => $drafted['name'],
            'category' => $drafted['category'],
            'parts' => CompileItemParts::normaliseParts($drafted['parts']),
        ]);
    }

    /**
     * Put an item on the shelf.
     */
    public function store(SaveLibraryItemRequest $request): RedirectResponse
    {
        $request->user()->libraryItems()->create($request->item());

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Saved to the library.')]);

        return to_route('library.index');
    }

    /**
     * Rename an item — or, when the designer resaves one, replace its
     * geometry too.
     */
    public function update(SaveLibraryItemRequest $request, LibraryItem $libraryItem): RedirectResponse
    {
        Gate::authorize('update', $libraryItem);

        $libraryItem->update($request->item());

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Library item updated.')]);

        return to_route('library.index');
    }

    /**
     * Publish what is on the browser's board, and read back whatever Claude
     * Code has done to it.
     *
     * This is the bridge that lets a Claude subscription drive the designer:
     * Claude Code runs on the person's own plan and works this row over MCP,
     * so nothing here bills an API account. The browser sends its parts only
     * when it is the one that changed them — `publish` false is a plain poll.
     */
    public function board(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'publish' => ['nullable', 'boolean'],
            'parts' => ['nullable', 'array', 'max:'.CompileItemParts::MAX_PARTS],
            'name' => ['nullable', 'string', 'max:120'],
            'category' => ['nullable', 'string', 'max:60'],
            'message' => ['nullable', 'string', 'max:2000'],
        ]);

        /** @var DesignBoard $board */
        $board = DesignBoard::query()->firstOrNew(
            ['user_id' => $request->user()->id],
            ['parts' => [], 'revision' => 0],
        );

        if (! $board->exists) {
            // user_id is guarded, so it is set alongside rather than filled.
            $board->forceFill([
                'user_id' => $request->user()->id,
                'parts' => [],
                'revision' => 0,
            ])->save();
        }

        $board->forceFill(['opened_at' => now()])->saveQuietly();

        if ($validated['publish'] ?? false) {
            $board->publish($validated['parts'] ?? [], 'browser', array_filter([
                'name' => $validated['name'] ?? null,
                'category' => $validated['category'] ?? null,
            ], fn ($value): bool => $value !== null));
        }

        if (filled($validated['message'] ?? null)) {
            // Queued for Claude Code to pick up on its next read.
            $board->forceFill(['message' => $validated['message']])->save();
        }

        return response()->json([
            'revision' => $board->revision,
            'source' => $board->source,
            'parts' => $board->parts,
            'name' => $board->name,
            'category' => $board->category,
            'note' => $board->note,
            'waiting' => filled($board->message),
            'claimed_at' => $board->claimed_at?->toIso8601String(),
        ]);
    }

    /**
     * One turn at the designer's terminal.
     *
     * The transcript lives in the browser, like every assistant here; each
     * turn carries it back with the board as it stands. The reply is talk,
     * and sometimes a new board — which faces exactly the same rules as
     * every other author of parts before the designer sees it.
     */
    public function terminal(Request $request, DraftItemParts $draft): JsonResponse
    {
        $validated = $request->validate([
            'provider' => ['required', 'string'],
            'messages' => ['required', 'array', 'min:1', 'max:40'],
            'messages.*.role' => ['required', 'string', 'in:user,assistant'],
            'messages.*.content' => ['required', 'string', 'max:4000'],
            'parts' => ['nullable', 'array', 'max:'.CompileItemParts::MAX_PARTS],
        ]);

        $connection = $request->user()
            ->aiConnections()
            ->where('provider', $validated['provider'])
            ->first();

        if ($connection === null) {
            return response()->json([
                'message' => __('That AI is not connected yet. Type /connect to add its key.'),
            ], 422);
        }

        $transcript = array_map(
            fn (array $message): array => [
                'role' => $message['role'],
                'content' => $message['content'],
            ],
            array_slice($validated['messages'], -20),
        );

        try {
            $turn = $draft->converse($connection, $transcript, $validated['parts'] ?? []);
        } catch (RuntimeException $failure) {
            return response()->json(['message' => $failure->getMessage()], 503);
        }

        // The talk survives even when the board change does not.
        return response()->json($this->settleTurn($turn));
    }

    /**
     * One turn with Claude Code on this machine.
     *
     * The same board protocol as the keyed terminal, but the answer comes
     * from the Claude account this person signed in with — so it costs
     * nothing beyond their own subscription, and nothing at all to anybody
     * else. The session id travels with the conversation so each turn
     * remembers the last.
     */
    public function claudeCode(Request $request, RunClaudeCode $claude, DraftItemParts $draft): JsonResponse
    {
        $validated = $request->validate([
            'prompt' => ['required', 'string', 'min:1', 'max:4000'],
            'session' => ['nullable', 'string', 'max:100'],
            'parts' => ['nullable', 'array', 'max:'.CompileItemParts::MAX_PARTS],
        ]);

        $account = $request->user()->claudeAccount;

        if ($account === null) {
            return response()->json([
                'message' => __('Sign in with your Claude account to use the terminal. A turn is drawn from your own subscription, so it has to be yours.'),
            ], 403);
        }

        try {
            $answer = $claude->handle(
                $account,
                $validated['prompt'],
                $draft->terminalBrief($validated['parts'] ?? []),
                $validated['session'] ?? null,
            );
        } catch (RuntimeException $failure) {
            return response()->json(['message' => $failure->getMessage()], 503);
        }

        $turn = $draft->parseTerminal($answer['text']);

        return response()->json([
            ...$this->settleTurn($turn),
            'session' => $answer['session'],
        ]);
    }

    /**
     * Hold a terminal turn's board change to the same rules every other
     * author of parts meets, keeping the talk either way.
     *
     * @param  array{say: string, parts: array<int, array<string, mixed>>|null, name: string|null, category: string|null}  $turn
     * @return array<string, mixed>
     */
    private function settleTurn(array $turn): array
    {
        if ($turn['parts'] === null) {
            return [...$turn, 'refused' => null];
        }

        $checked = Validator::make(['parts' => $turn['parts']], CompileItemParts::partRules());

        if ($checked->fails()) {
            return [
                'say' => $turn['say'],
                'parts' => null,
                'name' => null,
                'category' => null,
                'refused' => __('It offered parts the designer cannot build, so the board was left alone.'),
            ];
        }

        return [
            ...$turn,
            'parts' => CompileItemParts::normaliseParts($turn['parts']),
            'refused' => null,
        ];
    }

    /**
     * Rename an item from the shelf, without touching its geometry.
     */
    public function rename(Request $request, LibraryItem $libraryItem): RedirectResponse
    {
        Gate::authorize('update', $libraryItem);

        $libraryItem->update($request->validate([
            'name' => ['required', 'string', 'max:120'],
            'category' => ['required', 'string', 'max:60'],
        ]));

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Library item renamed.')]);

        return back();
    }

    /**
     * Take an item off the shelf. Copies already placed in drawings keep
     * their geometry — the mesh lives in the document once placed.
     */
    public function destroy(LibraryItem $libraryItem): RedirectResponse
    {
        Gate::authorize('delete', $libraryItem);

        $libraryItem->delete();

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Removed from the library.')]);

        return back();
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function shelf(Request $request): array
    {
        return $request->user()
            ->teamLibraryItems()
            ->with('user:id,name')
            ->orderBy('category')
            ->orderBy('name')
            ->get()
            ->map(fn (LibraryItem $item): array => [
                'id' => $item->id,
                'name' => $item->name,
                'category' => $item->category,
                'kind' => $item->kind,
                'thumbnail' => $item->thumbnail,
                'triangles' => $item->triangles,
                'editable' => $item->isEditable(),
                'author' => $item->user?->name,
                'created_at' => $item->created_at?->toIso8601String(),
            ])
            ->all();
    }
}
