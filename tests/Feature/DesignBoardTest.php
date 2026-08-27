<?php

use App\Mcp\Servers\CadServer;
use App\Mcp\Tools\GetDesignBoardTool;
use App\Mcp\Tools\SetDesignBoardTool;
use App\Models\DesignBoard;
use App\Models\User;
use Illuminate\Testing\Fluent\AssertableJson;

/**
 * A part as any author of parts sends one.
 */
function boardPart(array $overrides = []): array
{
    return array_replace([
        'shape' => 'box',
        'name' => 'Seat',
        'width' => 1800,
        'depth' => 900,
        'height' => 420,
    ], $overrides);
}

test('guests cannot touch the board', function () {
    $this->post(route('library.board'), [])->assertRedirect(route('login'));
});

test('opening the terminal creates a board and publishes what is on screen', function () {
    $user = User::factory()->create();

    $this->actingAs($user)
        ->postJson(route('library.board'), [
            'publish' => true,
            'parts' => [boardPart()],
        ])
        ->assertOk()
        ->assertJsonPath('revision', 1)
        ->assertJsonPath('source', 'browser')
        ->assertJsonPath('parts.0.name', 'Seat');

    expect($user->fresh()->id)->not->toBeNull()
        ->and(DesignBoard::query()->where('user_id', $user->id)->exists())->toBeTrue();
});

test('a plain poll neither bumps the revision nor loses the board', function () {
    $user = User::factory()->create();

    $this->actingAs($user)->postJson(route('library.board'), [
        'publish' => true,
        'parts' => [boardPart()],
    ]);

    $this->actingAs($user)
        ->postJson(route('library.board'), [])
        ->assertOk()
        ->assertJsonPath('revision', 1)
        ->assertJsonCount(1, 'parts');
});

test('Claude Code reads the board, and the browser sees the change it makes', function () {
    $user = User::factory()->create();

    // The browser opens the designer with a part already on the board.
    $this->actingAs($user)->postJson(route('library.board'), [
        'publish' => true,
        'parts' => [boardPart()],
        'name' => 'Sofa',
    ]);

    // Claude Code, over MCP, reads what is there…
    CadServer::tool(GetDesignBoardTool::class)
        ->assertOk()
        ->assertStructuredContent(fn (AssertableJson $board) => $board
            ->where('part_count', 1)
            ->where('parts.0.name', 'Seat')
            ->where('someone_is_watching', true)
            ->etc());

    // …then writes back a revised board.
    CadServer::tool(SetDesignBoardTool::class, [
        'note' => 'thinned the seat and added a back',
        'parts' => [
            boardPart(['width' => 1600]),
            boardPart(['name' => 'Back', 'depth' => 200, 'height' => 580, 'z' => 350]),
        ],
    ])->assertOk();

    // The browser's next poll carries it.
    $this->actingAs($user)
        ->postJson(route('library.board'), [])
        ->assertOk()
        ->assertJsonPath('revision', 2)
        ->assertJsonPath('source', 'claude')
        ->assertJsonPath('note', 'thinned the seat and added a back')
        ->assertJsonCount(2, 'parts')
        ->assertJsonPath('parts.1.name', 'Back')
        ->assertJsonPath('parts.1.z', 350);
});

test('a note typed in the browser waits for Claude Code, then is cleared', function () {
    $user = User::factory()->create();

    $this->actingAs($user)->postJson(route('library.board'), [
        'publish' => true,
        'parts' => [boardPart()],
    ]);

    $this->actingAs($user)
        ->postJson(route('library.board'), ['message' => 'make the arms thinner'])
        ->assertOk()
        ->assertJsonPath('waiting', true);

    CadServer::tool(GetDesignBoardTool::class)
        ->assertStructuredContent(fn (AssertableJson $board) => $board
            ->where('they_said', 'make the arms thinner')
            ->etc());

    // Read once, gone — it is not repeated on the next look.
    CadServer::tool(GetDesignBoardTool::class)
        ->assertStructuredContent(fn (AssertableJson $board) => $board
            ->where('they_said', null)
            ->etc());

    $this->actingAs($user)
        ->postJson(route('library.board'), [])
        ->assertJsonPath('waiting', false);
});

test('reading the board tells the browser Claude Code has arrived', function () {
    $user = User::factory()->create();

    $this->actingAs($user)->postJson(route('library.board'), [
        'publish' => true,
        'parts' => [boardPart()],
    ]);

    $this->actingAs($user)
        ->postJson(route('library.board'), [])
        ->assertJsonPath('claimed_at', null);

    CadServer::tool(GetDesignBoardTool::class)->assertOk();

    $claimed = $this->actingAs($user)->postJson(route('library.board'), []);

    expect($claimed->json('claimed_at'))->not->toBeNull();
});

test('Claude Code is told plainly when no board is open', function () {
    CadServer::tool(GetDesignBoardTool::class)
        ->assertHasErrors()
        ->assertSee('No design board is open');

    CadServer::tool(SetDesignBoardTool::class, ['parts' => [boardPart()]])
        ->assertHasErrors()
        ->assertSee('No design board is open');
});

test('parts the designer cannot build are refused at the MCP door', function () {
    $user = User::factory()->create();

    $this->actingAs($user)->postJson(route('library.board'), [
        'publish' => true,
        'parts' => [boardPart()],
    ]);

    CadServer::tool(SetDesignBoardTool::class, [
        'parts' => [['shape' => 'dodecahedron', 'height' => 100]],
    ])->assertHasErrors();

    // The board is untouched.
    $this->actingAs($user)
        ->postJson(route('library.board'), [])
        ->assertJsonPath('revision', 1)
        ->assertJsonPath('source', 'browser');
});

test('a sketch part from Claude Code is centred like every other author’s', function () {
    $user = User::factory()->create();

    $this->actingAs($user)->postJson(route('library.board'), [
        'publish' => true,
        'parts' => [boardPart()],
    ]);

    CadServer::tool(SetDesignBoardTool::class, [
        'parts' => [[
            'shape' => 'sketch',
            'height' => 40,
            'z' => 400,
            'points' => [
                ['x' => 1000, 'y' => 2000],
                ['x' => 1600, 'y' => 2000],
                ['x' => 1600, 'y' => 2400],
            ],
        ]],
    ])->assertOk();

    $board = $this->actingAs($user)->postJson(route('library.board'), []);

    expect($board->json('parts.0.width'))->toEqualWithDelta(600.0, 0.001)
        ->and(min(array_column($board->json('parts.0.points'), 'x')))
        ->toEqualWithDelta(-300.0, 0.001);
});

test('a board nobody is watching says so, rather than pretending', function () {
    $user = User::factory()->create();

    $this->actingAs($user)->postJson(route('library.board'), [
        'publish' => true,
        'parts' => [boardPart()],
    ]);

    // They wandered off well past the watching window.
    DesignBoard::query()->update([
        'opened_at' => now()->subMinutes(DesignBoard::AT_THE_BOARD_MINUTES + 5),
    ]);

    CadServer::tool(GetDesignBoardTool::class)
        ->assertStructuredContent(fn (AssertableJson $board) => $board
            ->where('someone_is_watching', false)
            ->etc());

    CadServer::tool(SetDesignBoardTool::class, ['parts' => [boardPart()]])
        ->assertStructuredContent(fn (AssertableJson $board) => $board
            ->where('someone_is_watching', false)
            ->etc());
});
