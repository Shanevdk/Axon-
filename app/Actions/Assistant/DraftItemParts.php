<?php

namespace App\Actions\Assistant;

use App\Actions\Library\CompileItemParts;
use App\Models\AiConnection;
use Illuminate\Http\Client\Response as HttpResponse;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * Ask the user's own AI — whichever one they connected — to draft an item's
 * parts for the designer.
 *
 * The reply must be nothing but JSON in the same part language the designer
 * and the MCP tool speak; whatever comes back is parsed here and validated
 * by the caller with the same rules as every other author of parts. The AI
 * proposes, the compiler disposes.
 */
class DraftItemParts
{
    /**
     * The brief every provider gets, whoever they are.
     */
    private const BRIEF = <<<'PROMPT'
        You design furniture and objects for a CAD program by describing them
        as a list of parts. Reply with ONLY a JSON object — no prose, no code
        fences — of this exact shape:

        {"name": "Three-seat sofa", "category": "Furniture", "parts": [
          {"shape": "box", "name": "Seat", "width": 1800, "depth": 900,
           "height": 420, "x": 0, "y": 0, "z": 0, "rotation": 0}
        ]}

        The rules:
        - Every length is millimetres. Sizes must be believable for the real
          object — check them against furniture that exists.
        - shape is "box", "cylinder" or "sketch". A cylinder's width and
          depth are its two diameters. A sketch is a closed plan outline:
          give it "points": [{"x":…,"y":…}, …] and a "height" to extrude to;
          use it for curved or irregular plan shapes.
        - x and y place the part's centre in plan, measured from the item's
          centre. z is the height of the part's underside off the floor.
          rotation is degrees about vertical.
        - Give each part a "colour" as "#rrggbb" — the material it is really
          made of. Oak #c8a578, walnut #6b4a33, ash #ddcdb4, charcoal #3a3a3c,
          linen #d8d2c6, ochre #c58a3d, olive #6f7551, rust #a8543a, slate
          #5b6870, brass #b08d46, steel #9aa3a8, paper #efece6 — or any hex
          that suits. Frames and legs usually differ from cushions and tops.
        - At most 100 parts. Prefer few, well-proportioned parts over many.
        - When current parts are supplied, revise them according to the
          instruction and return the COMPLETE revised list, not a diff.
        PROMPT;

    /**
     * @param  array<int, array<string, mixed>>  $currentParts
     * @return array{name: string|null, category: string|null, parts: array<int, array<string, mixed>>}
     *
     * @throws RuntimeException when the provider fails or replies with prose
     */
    public function handle(AiConnection $connection, string $prompt, array $currentParts = []): array
    {
        $instruction = $currentParts === []
            ? $prompt
            : "Current parts:\n".json_encode($currentParts)."\n\nInstruction: {$prompt}";

        $reply = $this->ask($connection, self::BRIEF, [
            ['role' => 'user', 'content' => $instruction],
        ]);

        return $this->parse($reply);
    }

    /**
     * Sit at the terminal with the user: hold a conversation about the board
     * and change it mid-sentence.
     *
     * Unlike a one-shot draft, the reply may be talk alone — a question about
     * a measurement, a disagreement about proportions — or talk plus a new
     * board. The protocol is one JSON object with a `say` and an optional
     * `parts`; a model that answers in bare prose is treated as talking.
     *
     * @param  list<array{role: string, content: string}>  $messages
     * @param  array<int, array<string, mixed>>  $boardParts
     * @return array{say: string, parts: array<int, array<string, mixed>>|null, name: string|null, category: string|null}
     *
     * @throws RuntimeException when the provider refuses the request
     */
    public function converse(AiConnection $connection, array $messages, array $boardParts): array
    {
        $reply = $this->ask(
            $connection,
            $this->terminalBrief($boardParts),
            $messages,
        );

        return $this->parseTerminal($reply);
    }

    /**
     * @param  list<array{role: string, content: string}>  $messages
     */
    private function ask(AiConnection $connection, string $system, array $messages): string
    {
        return match ($connection->provider) {
            'anthropic' => $this->askAnthropic($connection, $system, $messages),
            'openai' => $this->askOpenAi($connection, $system, $messages),
            'openrouter' => $this->askOpenRouter($connection, $system, $messages),
            default => throw new RuntimeException("Unknown provider \"{$connection->provider}\"."),
        };
    }

    /**
     * The standing brief for a terminal session, carrying the board as it
     * stands so the model revises what is really there.
     *
     * @param  array<int, array<string, mixed>>  $boardParts
     */
    public function terminalBrief(array $boardParts): string
    {
        $board = $boardParts === []
            ? 'The board is empty.'
            : 'The board right now:'."\n".json_encode($boardParts);

        return implode("\n\n", [
            <<<'PROMPT'
            You are sitting at a terminal inside Axon's item designer, working
            a parts board together with the person typing. Reply with ONLY one
            JSON object, no code fences:

            {"say": "…", "parts": null, "name": null, "category": null}

            - "say" is what you print at the terminal. Terminal voice: brief,
              concrete, plain text. Ask when a measurement genuinely matters;
              never pad, never use markdown.
            - "parts" replaces the whole board — include it only when the
              board should change; otherwise null.
            - "name" and "category" are for the item; offer them once, when
              the object first takes shape.
            PROMPT,
            $board,
            self::BRIEF,
        ]);
    }

    /* ---------------------------------------------------------- providers */

    private function askAnthropic(AiConnection $connection, string $system, array $messages): string
    {
        $response = Http::withHeaders([
            'x-api-key' => $connection->key,
            'anthropic-version' => (string) config('services.anthropic.version'),
        ])
            ->timeout((int) config('services.anthropic.timeout'))
            ->post(rtrim((string) config('services.anthropic.url'), '/').'/v1/messages', [
                'model' => $connection->modelId(),
                'max_tokens' => 8192,
                'system' => $system,
                'messages' => $messages,
            ]);

        $this->refuseFailure('Claude', $response);

        $reply = data_get($response->json(), 'content.0.text');

        return is_string($reply) ? $reply : '';
    }

    private function askOpenAi(AiConnection $connection, string $system, array $messages): string
    {
        $response = Http::withToken($connection->key)
            ->timeout((int) config('services.openai.timeout'))
            ->post(rtrim((string) config('services.openai.url'), '/').'/v1/chat/completions', [
                'model' => $connection->modelId(),
                'messages' => [['role' => 'system', 'content' => $system], ...$messages],
            ]);

        $this->refuseFailure('OpenAI', $response);

        $reply = data_get($response->json(), 'choices.0.message.content');

        return is_string($reply) ? $reply : '';
    }

    private function askOpenRouter(AiConnection $connection, string $system, array $messages): string
    {
        $response = Http::withToken($connection->key)
            ->withHeaders([
                'HTTP-Referer' => config('app.url'),
                'X-Title' => config('app.name'),
            ])
            ->timeout((int) config('services.openrouter.timeout'))
            ->post(rtrim((string) config('services.openrouter.url'), '/').'/chat/completions', [
                'model' => $connection->modelId(),
                'messages' => [['role' => 'system', 'content' => $system], ...$messages],
            ]);

        $this->refuseFailure('OpenRouter', $response);

        $reply = data_get($response->json(), 'choices.0.message.content');

        return is_string($reply) ? $reply : '';
    }

    /**
     * Turn an upstream refusal into a sentence a person can act on. The
     * provider's own message is preferred when it says something.
     */
    private function refuseFailure(string $who, HttpResponse $response): void
    {
        if (! $response->failed()) {
            return;
        }

        Log::warning('An AI design draft was refused.', [
            'provider' => $who,
            'status' => $response->status(),
        ]);

        $said = data_get($response->json(), 'error.message');
        $said = is_string($said) && trim($said) !== '' ? trim($said) : null;

        throw new RuntimeException(match ($response->status()) {
            401, 403 => "{$who} rejected the API key. Check the key on this connection.",
            404 => $said ?? "{$who} does not recognise the model on this connection.",
            429 => "{$who} is rate limiting this key. Wait a moment and try again.",
            default => $said ?? "{$who} could not be reached. Try again in a moment.",
        });
    }

    /* -------------------------------------------------------------- parse */

    /**
     * Pull the JSON out of the reply, tolerating the code fences models add
     * no matter how firmly they are told not to.
     *
     * @return array{name: string|null, category: string|null, parts: array<int, array<string, mixed>>}
     */
    private function parse(string $reply): array
    {
        $open = strpos($reply, '{');
        $close = strrpos($reply, '}');

        $decoded = $open !== false && $close !== false && $close > $open
            ? json_decode(substr($reply, $open, $close - $open + 1), true)
            : null;

        $parts = is_array($decoded) ? ($decoded['parts'] ?? null) : null;

        if (! is_array($parts) || $parts === [] || count($parts) > CompileItemParts::MAX_PARTS) {
            throw new RuntimeException(
                'The model did not reply with a usable part list. Ask again, or word the object more concretely.'
            );
        }

        return [
            'name' => is_string($decoded['name'] ?? null) ? $decoded['name'] : null,
            'category' => is_string($decoded['category'] ?? null) ? $decoded['category'] : null,
            'parts' => array_values($parts),
        ];
    }

    /**
     * Read a terminal turn. A model that ignores the protocol and answers in
     * prose is still talking — the conversation survives; only the board
     * stays put.
     *
     * @return array{say: string, parts: array<int, array<string, mixed>>|null, name: string|null, category: string|null}
     */
    public function parseTerminal(string $reply): array
    {
        $open = strpos($reply, '{');
        $close = strrpos($reply, '}');

        $decoded = $open !== false && $close !== false && $close > $open
            ? json_decode(substr($reply, $open, $close - $open + 1), true)
            : null;

        if (! is_array($decoded) || ! is_string($decoded['say'] ?? null)) {
            return [
                'say' => trim($reply) !== '' ? trim($reply) : '…',
                'parts' => null,
                'name' => null,
                'category' => null,
            ];
        }

        $parts = $decoded['parts'] ?? null;

        return [
            'say' => $decoded['say'],
            'parts' => is_array($parts) && $parts !== [] ? array_values($parts) : null,
            'name' => is_string($decoded['name'] ?? null) ? $decoded['name'] : null,
            'category' => is_string($decoded['category'] ?? null) ? $decoded['category'] : null,
        ];
    }
}
