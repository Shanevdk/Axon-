<?php

use App\Actions\Library\CompileItemParts;
use App\Actions\Library\DrawItemSnapshot;
use App\Mcp\Servers\CadServer;
use App\Mcp\Tools\DesignLibraryItemTool;
use App\Mcp\Tools\GetLibraryItemTool;
use App\Mcp\Tools\ListLibraryItemsTool;
use App\Models\LibraryItem;
use App\Models\User;

/**
 * A couch as an AI would describe one: four boxes, millimetres.
 */
function couchParts(): array
{
    return [
        ['shape' => 'box', 'name' => 'Seat', 'width' => 1800, 'depth' => 900, 'height' => 420],
        ['shape' => 'box', 'name' => 'Back', 'width' => 1800, 'depth' => 200, 'height' => 580, 'y' => -350, 'z' => 350],
        ['shape' => 'box', 'name' => 'Left arm', 'width' => 220, 'depth' => 900, 'height' => 580, 'x' => -790],
        ['shape' => 'box', 'name' => 'Right arm', 'width' => 220, 'depth' => 900, 'height' => 580, 'x' => 790],
    ];
}

/* -------------------------------------------------- the PHP compiler twin */

test('the PHP compiler agrees with the browser about a box', function () {
    $mesh = (new CompileItemParts)->handle([[
        'shape' => 'box', 'width' => 600, 'depth' => 400, 'height' => 300,
        'x' => 0, 'y' => 0, 'z' => 0, 'rotation' => 0,
    ]]);

    // The same numbers the Vitest suite asserts of compileParts().
    expect($mesh['triangleCount'])->toBe(12)
        ->and($mesh['size'])->toEqual(['x' => 600.0, 'y' => 400.0, 'z' => 300.0])
        ->and(count($mesh['vertices']))->toBe(12 * 9);
});

test('the PHP compiler agrees about a cylinder and normalisation', function () {
    $mesh = (new CompileItemParts)->handle([[
        'shape' => 'cylinder', 'width' => 400, 'depth' => 400, 'height' => 500,
        'x' => 5000, 'y' => -2000, 'z' => 700, 'rotation' => 0,
    ]]);

    expect($mesh['triangleCount'])->toBe(48)
        ->and($mesh['size']['z'])->toEqualWithDelta(500.0, 0.001);

    // Normalised: base at zero, plan centred, exactly like the browser.
    $zs = array_values(array_filter(
        $mesh['vertices'],
        fn ($value, $index) => $index % 3 === 2,
        ARRAY_FILTER_USE_BOTH,
    ));

    expect(min($zs))->toEqualWithDelta(0.0, 0.001);
});

test('the PHP compiler extrudes a sketched outline like the browser does', function () {
    $mesh = (new CompileItemParts)->handle([[
        'shape' => 'sketch', 'width' => 400, 'depth' => 300, 'height' => 50,
        'x' => 0, 'y' => 0, 'z' => 0, 'rotation' => 0,
        'points' => [
            ['x' => -200, 'y' => -150],
            ['x' => 200, 'y' => -150],
            ['x' => 200, 'y' => 150],
            ['x' => -200, 'y' => 150],
        ],
    ]]);

    // 2 ears top + 2 bottom + 4 sides × 2 — the browser's number.
    expect($mesh['triangleCount'])->toBe(12)
        ->and($mesh['size'])->toEqual(['x' => 400.0, 'y' => 300.0, 'z' => 50.0]);
});

test('the PHP snapshot draws the same kind of SVG the browser does', function () {
    $mesh = (new CompileItemParts)->handle([[
        'shape' => 'box', 'width' => 600, 'depth' => 600, 'height' => 400,
        'x' => 0, 'y' => 0, 'z' => 0, 'rotation' => 0,
    ]]);

    $snapshot = (new DrawItemSnapshot)->handle($mesh['vertices']);

    expect($snapshot)->toStartWith('data:image/svg+xml');

    $svg = rawurldecode(explode(',', $snapshot, 2)[1]);

    expect($svg)->toContain('<polygon')
        ->and($svg)->toContain('viewBox=')
        // Back-face culling: a box shows at most three faces, six triangles.
        ->and(substr_count($svg, '<polygon'))->toBeLessThanOrEqual(6);
});

/* ------------------------------------------------------------- the tools */

test('an AI designs a couch onto the shelf over MCP', function () {
    User::factory()->create();

    $response = CadServer::tool(DesignLibraryItemTool::class, [
        'name' => 'Studio Couch',
        'category' => 'Furniture',
        'parts' => couchParts(),
    ]);

    $response->assertOk()->assertSee('Studio Couch');

    $item = LibraryItem::query()->sole();

    expect($item->kind)->toBe('designed')
        ->and($item->triangles)->toBe(48) // four boxes
        ->and($item->payload['parts'])->toHaveCount(4)
        ->and($item->thumbnail)->toStartWith('data:image/svg+xml')
        ->and($item->payload['size']['x'])->toEqualWithDelta(1800.0, 0.001);
});

test('a designed item is revised in place by sending parts back', function () {
    User::factory()->create();

    CadServer::tool(DesignLibraryItemTool::class, [
        'name' => 'Studio Couch',
        'parts' => couchParts(),
    ]);

    $item = LibraryItem::query()->sole();

    // Longer couch: stretch the seat, keep the rest.
    $parts = couchParts();
    $parts[0]['width'] = 2400;

    $response = CadServer::tool(DesignLibraryItemTool::class, [
        'item_id' => $item->id,
        'parts' => $parts,
    ]);

    $response->assertOk();

    expect($item->fresh())
        ->name->toBe('Studio Couch')
        ->and($item->fresh()->payload['size']['x'])->toEqualWithDelta(2400.0, 0.001);
});

test('an imported item cannot be revised — it has no parts', function () {
    $item = LibraryItem::factory()->create();

    $response = CadServer::tool(DesignLibraryItemTool::class, [
        'item_id' => $item->id,
        'parts' => couchParts(),
    ]);

    $response->assertHasErrors();
});

test('a sketch part travels over MCP and is centred like the browser centres it', function () {
    User::factory()->create();

    $response = CadServer::tool(DesignLibraryItemTool::class, [
        'name' => 'Kidney Table',
        'parts' => [[
            'shape' => 'sketch', 'height' => 40, 'z' => 400,
            'points' => [
                ['x' => 1000, 'y' => 2000],
                ['x' => 1600, 'y' => 2000],
                ['x' => 1600, 'y' => 2400],
                ['x' => 1000, 'y' => 2400],
            ],
        ]],
    ]);

    $response->assertOk();

    $part = LibraryItem::query()->sole()->payload['parts'][0];

    expect($part['width'])->toEqualWithDelta(600.0, 0.001)
        ->and($part['depth'])->toEqualWithDelta(400.0, 0.001)
        ->and(min(array_column($part['points'], 'x')))->toEqualWithDelta(-300.0, 0.001);
});

test('a design past the triangle ceiling is refused with the number', function () {
    User::factory()->create();

    // 100 cylinders at 48 triangles each is fine; the ceiling needs a crowd
    // of sketches. 100 parts × 500-corner outlines ≈ 199,600 triangles.
    $circle = [];

    for ($corner = 0; $corner < 400; $corner++) {
        $angle = $corner / 400 * M_PI * 2;
        $circle[] = ['x' => cos($angle) * 500, 'y' => sin($angle) * 500];
    }

    $parts = array_fill(0, 30, [
        'shape' => 'sketch', 'height' => 100, 'points' => $circle,
    ]);

    $response = CadServer::tool(DesignLibraryItemTool::class, [
        'name' => 'Too Heavy',
        'parts' => $parts,
    ]);

    $response->assertHasErrors();

    expect(LibraryItem::query()->count())->toBe(0);
});

test('the shelf and a single item read back over MCP', function () {
    User::factory()->create();

    CadServer::tool(DesignLibraryItemTool::class, [
        'name' => 'Studio Couch',
        'parts' => couchParts(),
    ]);

    CadServer::tool(ListLibraryItemsTool::class)
        ->assertOk()
        ->assertSee('Studio Couch');

    $item = LibraryItem::query()->sole();

    CadServer::tool(GetLibraryItemTool::class, ['item_id' => $item->id])
        ->assertOk()
        ->assertSee('Seat');
});

test('with no user registered the tool explains instead of crashing', function () {
    $response = CadServer::tool(DesignLibraryItemTool::class, [
        'name' => 'Orphan Couch',
        'parts' => couchParts(),
    ]);

    $response->assertHasErrors();

    expect(LibraryItem::query()->count())->toBe(0);
});
