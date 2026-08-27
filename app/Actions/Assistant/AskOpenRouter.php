<?php

namespace App\Actions\Assistant;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * Puts a question to OpenRouter and hands back the answer.
 *
 * OpenRouter speaks the OpenAI chat-completions shape, so the whole exchange
 * is one POST carrying the running transcript. The model is configured rather
 * than hard-coded because free slugs come and go.
 */
class AskOpenRouter
{
    /**
     * The assistant's standing brief.
     *
     * It knows what Axon is so drawing questions land somewhere useful, but it
     * is explicitly free to answer anything — this is the general-questions
     * companion, not a support bot.
     */
    public const SYSTEM_PROMPT = <<<'PROMPT'
        You are Axon's assistant, built into Axon — a browser-based architectural
        drafting and modelling application in the mould of Revit, made by Van Haven.

        Answer whatever you are asked, on any subject. You are a general-purpose
        assistant first and a drafting companion second. When a question does touch
        the software, remember that Axon models in millimetres internally and can
        show either metric or imperial units, draws plans, elevations, sections and
        3D views, and exchanges DXF, STL, OBJ and STEP.

        Be direct and concise. Use plain prose; reach for a short list only when the
        answer really is a list. Say plainly when you do not know something.
        PROMPT;

    /**
     * How many turns of history travel with each question.
     *
     * Free models carry small context windows, so the transcript is clipped to
     * the tail rather than sent whole.
     */
    public const HISTORY_LIMIT = 20;

    /**
     * Ask the model, returning the reply text.
     *
     * @param  list<array{role: string, content: string}>  $messages
     *
     * @throws RuntimeException when the assistant is unconfigured or upstream fails
     */
    public function handle(array $messages): string
    {
        return $this->ask(self::SYSTEM_PROMPT, $messages);
    }

    /**
     * Ask under a brief of the caller's choosing.
     *
     * The general assistant and the editor's code consultant differ only in
     * what they are told they are, so the transport — the key check, the
     * history clip, the error wording — is shared and only the system message
     * changes.
     *
     * @param  list<array{role: string, content: string}>  $messages
     *
     * @throws RuntimeException when the assistant is unconfigured or upstream fails
     */
    public function ask(string $systemPrompt, array $messages): string
    {
        $key = config('services.openrouter.key');

        if (blank($key)) {
            throw new RuntimeException(
                'The assistant is not configured yet. Add an OPENROUTER_API_KEY to your .env file.'
            );
        }

        $response = Http::withToken($key)
            ->withHeaders([
                // OpenRouter attributes usage to these two on its dashboard.
                'HTTP-Referer' => config('app.url'),
                'X-Title' => config('app.name'),
            ])
            ->timeout((int) config('services.openrouter.timeout'))
            ->post($this->endpoint(), [
                'model' => config('services.openrouter.model'),
                'messages' => [
                    ['role' => 'system', 'content' => $systemPrompt],
                    ...array_slice($messages, -self::HISTORY_LIMIT),
                ],
            ]);

        if ($response->failed()) {
            Log::warning('OpenRouter refused the request.', [
                'status' => $response->status(),
                'body' => $response->body(),
            ]);

            throw new RuntimeException($this->reasonFor(
                $response->status(),
                data_get($response->json(), 'error.message'),
            ));
        }

        $reply = data_get($response->json(), 'choices.0.message.content');

        if (! is_string($reply) || trim($reply) === '') {
            throw new RuntimeException('The model came back empty. Try asking again.');
        }

        return trim($reply);
    }

    /**
     * The chat-completions URL, tolerant of a trailing slash in config.
     */
    private function endpoint(): string
    {
        return rtrim((string) config('services.openrouter.url'), '/').'/chat/completions';
    }

    /**
     * Turn an upstream failure into something worth showing a person.
     *
     * Free slugs get retired without warning, and OpenRouter says so plainly
     * in its own error body, so that message is preferred over a guess
     * whenever the request itself was the problem.
     */
    private function reasonFor(int $status, mixed $upstream): string
    {
        $said = is_string($upstream) && trim($upstream) !== '' ? trim($upstream) : null;

        return match ($status) {
            400, 404 => $said ?? 'OpenRouter does not recognise this model. Check OPENROUTER_MODEL.',
            401, 403 => 'OpenRouter rejected the API key. Check OPENROUTER_API_KEY.',
            402 => 'This model needs credit on the OpenRouter account. Switch OPENROUTER_MODEL to a free slug.',
            429 => 'The free model is busy right now. Wait a moment and ask again.',
            default => $said ?? 'The assistant could not be reached. Try again in a moment.',
        };
    }
}
