<?php

namespace App\Mcp\Tools;

use App\Actions\Library\CompileItemParts;
use App\Actions\Library\DrawItemSnapshot;
use App\Models\LibraryItem;
use App\Models\User;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tool;

#[Name('design-library-item')]
#[Description(<<<'TEXT'
    Design a reusable item — a couch, a table, anything — and put it on the
    library shelf, where the editor places it into drawings. Build it from
    parts, every length in millimetres: boxes and cylinders sized
    width × depth × height at x/y (plan, from the item centre) and z (height
    of the underside), rotated in degrees; or a sketch, a closed outline of
    plan points extruded to its height. Give each part a "colour" as
    "#rrggbb" for the material it is made of — oak #c8a578, walnut #6b4a33,
    charcoal #3a3a3c, linen #d8d2c6, brass #b08d46, and so on. Pass item_id to revise a designed
    item — the parts you send replace its parts. The mesh, plan footprint
    and thumbnail are compiled here, identically to the in-browser designer.
    TEXT)]
class DesignLibraryItemTool extends Tool
{
    public function handle(Request $request): Response|ResponseFactory
    {
        $validated = $request->validate([
            'item_id' => ['nullable', 'integer', 'exists:library_items,id'],
            'name' => ['required_without:item_id', 'string', 'max:120'],
            'category' => ['nullable', 'string', 'max:60'],
            ...CompileItemParts::partRules(),
        ], [
            'parts.required' => 'Provide parts as [{"shape":"box","width":1800,"depth":900,"height":420}, …] in millimetres.',
            'parts.*.points.required_if' => 'A sketch part needs points: a closed plan outline of at least three corners.',
        ]);

        $item = isset($validated['item_id'])
            ? LibraryItem::query()->findOrFail($validated['item_id'])
            : null;

        if ($item !== null && ! $item->isEditable()) {
            return Response::error(
                "Item {$item->id} was imported from a file, so it has no parts to revise. Design a new item instead."
            );
        }

        $parts = CompileItemParts::normaliseParts($validated['parts']);
        $mesh = (new CompileItemParts)->handle($parts);

        if ($mesh['triangleCount'] === 0) {
            return Response::error(
                'Those parts compile to nothing — check that sketch outlines have three or more distinct corners.'
            );
        }

        if ($mesh['triangleCount'] > LibraryItem::MAX_TRIANGLES) {
            return Response::error(sprintf(
                'That design compiles to %s triangles; the library ceiling is %s.',
                number_format($mesh['triangleCount']),
                number_format(LibraryItem::MAX_TRIANGLES),
            ));
        }

        $attributes = [
            'name' => $validated['name'] ?? $item?->name,
            'category' => $validated['category'] ?? $item?->category ?? 'Furniture',
            'kind' => 'designed',
            'thumbnail' => (new DrawItemSnapshot)->handle($mesh['vertices']),
            'payload' => [...$mesh, 'parts' => $parts],
            'triangles' => $mesh['triangleCount'],
        ];

        if ($item !== null) {
            $item->update($attributes);
        } else {
            $owner = User::query()->orderBy('id')->first();

            if ($owner === null) {
                return Response::error('No user account exists yet to own the item. Register in Axon first.');
            }

            $item = $owner->libraryItems()->create($attributes);
        }

        return Response::structured([
            'id' => $item->id,
            'name' => $item->name,
            'category' => $item->category,
            'triangles' => $mesh['triangleCount'],
            'size_mm' => $mesh['size'],
            'note' => 'On the shelf. In the editor it is under Insert → Library (LB); the designer page can reopen it part by part.',
        ]);
    }
}
