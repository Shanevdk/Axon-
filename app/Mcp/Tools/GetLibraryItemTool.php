<?php

namespace App\Mcp\Tools;

use App\Mcp\Tools\Concerns\ScopesToTheAsker;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tool;
use Laravel\Mcp\Server\Tools\Annotations\IsIdempotent;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Name('get-library-item')]
#[Description('Read one library item. A designed item comes back with its part list (boxes, cylinders and sketched outlines in millimetres), which design-library-item accepts back for revisions.')]
#[IsReadOnly]
#[IsIdempotent]
class GetLibraryItemTool extends Tool
{
    use ScopesToTheAsker;

    public function handle(Request $request): Response|ResponseFactory
    {
        $validated = $request->validate([
            'item_id' => ['required', 'integer'],
        ]);

        $item = $this->visibleLibraryItems()->find($validated['item_id']);

        if ($item === null) {
            return $this->refuseUnknownItem();
        }

        return Response::structured([
            'id' => $item->id,
            'name' => $item->name,
            'category' => $item->category,
            'kind' => $item->kind,
            'triangles' => $item->triangles,
            'size_mm' => $item->payload['size'] ?? null,
            'editable' => $item->isEditable(),
            // Geometry is deliberately withheld — it can run to megabytes.
            // Parts are the editable description, and all an AI needs.
            'parts' => $item->isEditable() ? ($item->payload['parts'] ?? []) : null,
        ]);
    }
}
