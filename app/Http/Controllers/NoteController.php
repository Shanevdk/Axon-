<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreNoteRequest;
use App\Http\Requests\UpdateNoteRequest;
use App\Models\Note;
use App\Models\Project;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

class NoteController extends Controller
{
    /**
     * The studio notebook.
     */
    public function index(Request $request): Response
    {
        $notes = $request->user()
            ->teamNotes()
            ->with(['user:id,name', 'project:id,name,number'])
            ->inReadingOrder()
            ->get();

        return Inertia::render('notes/index', [
            'notes' => $notes->map(fn (Note $note): array => $this->row($note)),
            'projects' => $this->drawings($request),
        ]);
    }

    /**
     * Write a new note.
     */
    public function store(StoreNoteRequest $request): RedirectResponse
    {
        $request->user()->notes()->create($request->validated());

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Note saved.')]);

        return back();
    }

    /**
     * Revise a note.
     */
    public function update(UpdateNoteRequest $request, Note $note): RedirectResponse
    {
        $note->update($request->validated());

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Note saved.')]);

        return back();
    }

    /**
     * Hold a note at the top of the notebook, or let it fall back in line.
     */
    public function pin(Note $note): RedirectResponse
    {
        Gate::authorize('update', $note);

        // Toggled server side so the button cannot be used to set an arbitrary
        // state, and so two people pinning at once cannot disagree.
        $note->update(['pinned' => ! $note->pinned]);

        return back();
    }

    /**
     * Tear a note out.
     */
    public function destroy(Note $note): RedirectResponse
    {
        Gate::authorize('delete', $note);

        $note->delete();

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Note removed.')]);

        return back();
    }

    /**
     * @return array<string, mixed>
     */
    private function row(Note $note): array
    {
        return [
            'id' => $note->id,
            'title' => $note->title,
            'body' => $note->body,
            'excerpt' => $note->excerpt(),
            'pinned' => $note->pinned,
            'author' => $note->user?->name,
            'project_id' => $note->project_id,
            'project_name' => $note->project?->name,
            'updated_at' => $note->updated_at?->toIso8601String(),
        ];
    }

    /**
     * The drawings a note can be filed against.
     *
     * @return array<int, array{id: int, name: string, number: string|null}>
     */
    private function drawings(Request $request): array
    {
        return $request->user()
            ->teamProjects()
            ->orderBy('name')
            ->get(['id', 'name', 'number'])
            ->map(fn (Project $project): array => [
                'id' => $project->id,
                'name' => $project->name,
                'number' => $project->number,
            ])
            ->all();
    }
}
