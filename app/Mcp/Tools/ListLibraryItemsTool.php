<?php

namespace App\Mcp\Tools;

use App\Mcp\Tools\Concerns\ScopesToTheAsker;
use App\Models\LibraryItem;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tool;
use Laravel\Mcp\Server\Tools\Annotations\IsIdempotent;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Name('list-library-items')]
#[Description('List the model library: reusable items (couches, tables, imported scans) that can be placed in any drawing. Designed items are editable — get-library-item returns their part lists.')]
#[IsReadOnly]
#[IsIdempotent]
class ListLibraryItemsTool extends Tool
{
    use ScopesToTheAsker;

    public function handle(Request $request): Response|ResponseFactory
    {
        $items = $this->visibleLibraryItems()
            ->orderBy('category')
            ->orderBy('name')
            ->get()
            ->map(fn (LibraryItem $item): array => [
                'id' => $item->id,
                'name' => $item->name,
                'category' => $item->category,
                'kind' => $item->kind,
                'triangles' => $item->triangles,
                'size_mm' => $item->payload['size'] ?? null,
                'editable' => $item->isEditable(),
            ]);

        return Response::structured(['items' => $items->all()]);
    }
}
