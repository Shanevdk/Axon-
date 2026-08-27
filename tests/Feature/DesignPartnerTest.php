<?php

use App\Models\User;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Inertia\Testing\AssertableInertia;

/**
 * The JSON a well-behaved model replies with.
 */
function draftedCouch(): string
{
    return json_encode([
        'name' => 'Drafted Couch',
        'category' => 'Furniture',
        'parts' => [
            ['shape' => 'box', 'name' => 'Seat', 'width' => 1800, 'depth' => 900, 'height' => 420],
            ['shape' => 'box', 'name' => 'Back', 'width' => 1800, 'depth' => 200, 'height' => 580, 'y' => -350, 'z' => 350],
        ],
    ]);
}

function anthropicReply(string $text): array
{
    return ['content' => [['type' => 'text', 'text' => $text]]];
}

function openAiReply(string $text): array
{
    return ['choices' => [['message' => ['role' => 'assistant', 'content' => $text]]]];
}

beforeEach(function () {
    config()->set('services.anthropic.url', 'https://anthropic.test');
    config()->set('services.openai.url', 'https://openai.test');
    config()->set('services.openrouter.url', 'https://openrouter.test/api/v1');
});

/* ---------------------------------------------------------- connections */

test('guests cannot connect or draft', function () {
    $this->post(route('ai-connections.store'), [])->assertRedirect(route('login'));
    $this->post(route('library.draft'), [])->assertRedirect(route('login'));
});

test('a key is stored encrypted and connecting twice rekeys instead of duplicating', function () {
    $user = User::factory()->create();

    $this->actingAs($user)
        ->post(route('ai-connections.store'), [
            'provider' => 'anthropic',
            'key' => 'sk-ant-first',
        ])
        ->assertRedirect();

    $this->actingAs($user)
        ->post(route('ai-connections.store'), [
            'provider' => 'anthropic',
            'key' => 'sk-ant-second',
            'model' => 'claude-opus-5',
        ])
        ->assertRedirect();

    $connection = $user->aiConnections()->sole();

    expect($connection->key)->toBe('sk-ant-second')
        ->and($connection->model)->toBe('claude-opus-5')
        // Encrypted at rest: the raw column never carries the key.
        ->and($connection->getRawOriginal('key'))->not->toContain('sk-ant');
});

test('an unknown provider is refused', function () {
    $this->actingAs(User::factory()->create())
        ->post(route('ai-connections.store'), ['provider' => 'skynet', 'key' => 'k'])
        ->assertSessionHasErrors('provider');
});

test('the designer lists connections without ever sending the key', function () {
    $user = User::factory()->create();
    $user->aiConnections()->create(['provider' => 'anthropic', 'key' => 'sk-ant-secret']);

    $this->actingAs($user)
        ->get(route('library.designer'))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->has('connections', 1)
            ->where('connections.0.provider', 'anthropic')
            ->where('connections.0.label', 'Claude')
            ->where('connections.0.model', 'claude-sonnet-5')
            ->missing('connections.0.key')
        )
        ->assertDontSee('sk-ant-secret');
});

test('someone else cannot disconnect my account', function () {
    $mine = User::factory()->create();
    $connection = $mine->aiConnections()->create(['provider' => 'openai', 'key' => 'sk-mine']);

    $this->actingAs(User::factory()->create())
        ->delete(route('ai-connections.destroy', $connection))
        ->assertForbidden();

    expect($mine->aiConnections()->count())->toBe(1);
});

/* ------------------------------------------------------------- drafting */

test('Claude drafts parts that arrive normalised', function () {
    Http::fake(['anthropic.test/*' => Http::response(anthropicReply(draftedCouch()))]);

    $user = User::factory()->create();
    $user->aiConnections()->create(['provider' => 'anthropic', 'key' => 'sk-ant-test']);

    $this->actingAs($user)
        ->postJson(route('library.draft'), [
            'provider' => 'anthropic',
            'prompt' => 'a two-part couch',
        ])
        ->assertOk()
        ->assertJsonPath('name', 'Drafted Couch')
        ->assertJsonPath('parts.0.name', 'Seat')
        ->assertJsonPath('parts.0.id', 'part-1')
        ->assertJsonPath('parts.1.z', 350);

    Http::assertSent(function (Request $request): bool {
        return $request->url() === 'https://anthropic.test/v1/messages'
            && $request->hasHeader('x-api-key', 'sk-ant-test')
            && data_get($request->data(), 'model') === 'claude-sonnet-5'
            && str_contains((string) data_get($request->data(), 'system'), 'millimetres');
    });
});

test('OpenAI drafts through its own shape, code fences and all', function () {
    Http::fake([
        'openai.test/*' => Http::response(openAiReply(
            "```json\n".draftedCouch()."\n```",
        )),
    ]);

    $user = User::factory()->create();
    $user->aiConnections()->create(['provider' => 'openai', 'key' => 'sk-oa', 'model' => 'gpt-5']);

    $this->actingAs($user)
        ->postJson(route('library.draft'), [
            'provider' => 'openai',
            'prompt' => 'a couch',
        ])
        ->assertOk()
        ->assertJsonCount(2, 'parts');

    Http::assertSent(fn (Request $request): bool => $request->url() === 'https://openai.test/v1/chat/completions'
        && $request->hasHeader('Authorization', 'Bearer sk-oa')
        && data_get($request->data(), 'model') === 'gpt-5');
});

test('revising sends the current parts along', function () {
    Http::fake(['anthropic.test/*' => Http::response(anthropicReply(draftedCouch()))]);

    $user = User::factory()->create();
    $user->aiConnections()->create(['provider' => 'anthropic', 'key' => 'sk-ant']);

    $this->actingAs($user)
        ->postJson(route('library.draft'), [
            'provider' => 'anthropic',
            'prompt' => 'make it wider',
            'parts' => [
                ['shape' => 'box', 'name' => 'Old Seat', 'width' => 1500, 'depth' => 900, 'height' => 420],
            ],
        ])
        ->assertOk();

    Http::assertSent(fn (Request $request): bool => str_contains(
        (string) data_get($request->data(), 'messages.0.content'),
        'Old Seat',
    ));
});

test('a drafting AI must actually be connected', function () {
    Http::fake();

    $this->actingAs(User::factory()->create())
        ->postJson(route('library.draft'), [
            'provider' => 'anthropic',
            'prompt' => 'a couch',
        ])
        ->assertStatus(422)
        ->assertJsonPath('message', 'That AI is not connected yet. Add its key first.');

    Http::assertNothingSent();
});

test('prose instead of JSON is reported in words', function () {
    Http::fake([
        'anthropic.test/*' => Http::response(anthropicReply(
            'What a lovely couch that would be! Let me describe it…',
        )),
    ]);

    $user = User::factory()->create();
    $user->aiConnections()->create(['provider' => 'anthropic', 'key' => 'sk-ant']);

    $this->actingAs($user)
        ->postJson(route('library.draft'), [
            'provider' => 'anthropic',
            'prompt' => 'a couch',
        ])
        ->assertStatus(503)
        ->assertJsonPath(
            'message',
            'The model did not reply with a usable part list. Ask again, or word the object more concretely.',
        );
});

test('parts the designer cannot build are refused, not forwarded', function () {
    Http::fake([
        'anthropic.test/*' => Http::response(anthropicReply(json_encode([
            'name' => 'Nonsense',
            'parts' => [['shape' => 'dodecahedron', 'height' => 100]],
        ]))),
    ]);

    $user = User::factory()->create();
    $user->aiConnections()->create(['provider' => 'anthropic', 'key' => 'sk-ant']);

    $this->actingAs($user)
        ->postJson(route('library.draft'), [
            'provider' => 'anthropic',
            'prompt' => 'something impossible',
        ])
        ->assertStatus(503)
        ->assertJsonPath('message', 'The model replied with parts the designer cannot build. Ask again.');
});

test('a rejected key is explained with the provider named', function () {
    Http::fake([
        'openai.test/*' => Http::response(['error' => ['message' => 'Incorrect API key provided.']], 401),
    ]);

    $user = User::factory()->create();
    $user->aiConnections()->create(['provider' => 'openai', 'key' => 'sk-bad']);

    $this->actingAs($user)
        ->postJson(route('library.draft'), [
            'provider' => 'openai',
            'prompt' => 'a couch',
        ])
        ->assertStatus(503)
        ->assertJsonPath('message', 'OpenAI rejected the API key. Check the key on this connection.');
});

test('a sketch part in a draft is centred like every other author’s', function () {
    Http::fake([
        'openrouter.test/*' => Http::response(openAiReply(json_encode([
            'name' => 'Kidney Table',
            'parts' => [[
                'shape' => 'sketch', 'height' => 40, 'z' => 400,
                'points' => [
                    ['x' => 1000, 'y' => 2000],
                    ['x' => 1600, 'y' => 2000],
                    ['x' => 1600, 'y' => 2400],
                ],
            ]],
        ]))),
    ]);

    $user = User::factory()->create();
    $user->aiConnections()->create(['provider' => 'openrouter', 'key' => 'sk-or']);

    $response = $this->actingAs($user)
        ->postJson(route('library.draft'), [
            'provider' => 'openrouter',
            'prompt' => 'a kidney table',
        ])
        ->assertOk();

    expect($response->json('parts.0.width'))->toEqualWithDelta(600.0, 0.001)
        ->and(min(array_column($response->json('parts.0.points'), 'x')))
        ->toEqualWithDelta(-300.0, 0.001);
});

/* ------------------------------------------------------------- terminal */

function terminalReply(array $turn): array
{
    return anthropicReply(json_encode($turn));
}

test('a terminal turn can be talk alone, and the board stays put', function () {
    Http::fake([
        'anthropic.test/*' => Http::response(terminalReply([
            'say' => 'how wide is the wall it sits against?',
            'parts' => null,
        ])),
    ]);

    $user = User::factory()->create();
    $user->aiConnections()->create(['provider' => 'anthropic', 'key' => 'sk-ant']);

    $this->actingAs($user)
        ->postJson(route('library.terminal'), [
            'provider' => 'anthropic',
            'messages' => [['role' => 'user', 'content' => 'i want a couch']],
        ])
        ->assertOk()
        ->assertJsonPath('say', 'how wide is the wall it sits against?')
        ->assertJsonPath('parts', null)
        ->assertJsonPath('refused', null);
});

test('a terminal turn can change the board, normalised like every author', function () {
    Http::fake([
        'anthropic.test/*' => Http::response(terminalReply([
            'say' => 'here is a first pass.',
            'name' => 'Terminal Couch',
            'parts' => [
                ['shape' => 'box', 'name' => 'Seat', 'width' => 1800, 'depth' => 900, 'height' => 420],
            ],
        ])),
    ]);

    $user = User::factory()->create();
    $user->aiConnections()->create(['provider' => 'anthropic', 'key' => 'sk-ant']);

    $this->actingAs($user)
        ->postJson(route('library.terminal'), [
            'provider' => 'anthropic',
            'messages' => [['role' => 'user', 'content' => 'a couch, 1.8 m']],
        ])
        ->assertOk()
        ->assertJsonPath('say', 'here is a first pass.')
        ->assertJsonPath('name', 'Terminal Couch')
        ->assertJsonPath('parts.0.id', 'part-1')
        ->assertJsonPath('parts.0.name', 'Seat');
});

test('the transcript and the board both reach the model', function () {
    Http::fake([
        'anthropic.test/*' => Http::response(terminalReply(['say' => 'noted.'])),
    ]);

    $user = User::factory()->create();
    $user->aiConnections()->create(['provider' => 'anthropic', 'key' => 'sk-ant']);

    $this->actingAs($user)
        ->postJson(route('library.terminal'), [
            'provider' => 'anthropic',
            'messages' => [
                ['role' => 'user', 'content' => 'a couch'],
                ['role' => 'assistant', 'content' => 'how wide?'],
                ['role' => 'user', 'content' => 'two metres'],
            ],
            'parts' => [
                ['shape' => 'box', 'name' => 'Existing Seat', 'width' => 1500, 'depth' => 900, 'height' => 420,
                    'x' => 0, 'y' => 0, 'z' => 0, 'rotation' => 0, 'id' => 'part-1'],
            ],
        ])
        ->assertOk();

    Http::assertSent(function (Request $request): bool {
        $sent = $request->data();

        return count(data_get($sent, 'messages')) === 3
            && data_get($sent, 'messages.1.role') === 'assistant'
            && data_get($sent, 'messages.2.content') === 'two metres'
            && str_contains((string) data_get($sent, 'system'), 'Existing Seat')
            && str_contains((string) data_get($sent, 'system'), 'millimetres');
    });
});

test('a prose-only model still talks — the terminal does not break', function () {
    Http::fake([
        'anthropic.test/*' => Http::response(anthropicReply(
            'sure, thinking about a couch now',
        )),
    ]);

    $user = User::factory()->create();
    $user->aiConnections()->create(['provider' => 'anthropic', 'key' => 'sk-ant']);

    $this->actingAs($user)
        ->postJson(route('library.terminal'), [
            'provider' => 'anthropic',
            'messages' => [['role' => 'user', 'content' => 'a couch']],
        ])
        ->assertOk()
        ->assertJsonPath('say', 'sure, thinking about a couch now')
        ->assertJsonPath('parts', null);
});

test('unbuildable parts are refused but the talk survives', function () {
    Http::fake([
        'anthropic.test/*' => Http::response(terminalReply([
            'say' => 'behold my dodecahedron.',
            'parts' => [['shape' => 'dodecahedron', 'height' => 100]],
        ])),
    ]);

    $user = User::factory()->create();
    $user->aiConnections()->create(['provider' => 'anthropic', 'key' => 'sk-ant']);

    $this->actingAs($user)
        ->postJson(route('library.terminal'), [
            'provider' => 'anthropic',
            'messages' => [['role' => 'user', 'content' => 'something impossible']],
        ])
        ->assertOk()
        ->assertJsonPath('say', 'behold my dodecahedron.')
        ->assertJsonPath('parts', null)
        ->assertJsonPath(
            'refused',
            'It offered parts the designer cannot build, so the board was left alone.',
        );
});

test('the terminal needs a connection too', function () {
    Http::fake();

    $this->actingAs(User::factory()->create())
        ->postJson(route('library.terminal'), [
            'provider' => 'anthropic',
            'messages' => [['role' => 'user', 'content' => 'hello']],
        ])
        ->assertStatus(422)
        ->assertJsonPath('message', 'That AI is not connected yet. Type /connect to add its key.');

    Http::assertNothingSent();
});
