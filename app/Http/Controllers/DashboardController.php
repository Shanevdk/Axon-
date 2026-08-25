<?php

namespace App\Http\Controllers;

use App\Models\Project;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Inertia\Inertia;
use Inertia\Response;

class DashboardController extends Controller
{
    /**
     * How many plan previews are sent to the browser. The register only shows
     * this many thumbnails, so anything past it is summarised instead.
     */
    private const PREVIEWS_ON_DASHBOARD = 6;

    /**
     * The practice overview.
     */
    public function index(Request $request): Response
    {
        $projects = $request->user()
            ->teamProjects()
            ->latest('opened_at')
            ->latest('id')
            ->get();

        $withPreviews = $projects->take(self::PREVIEWS_ON_DASHBOARD)->pluck('id')->all();

        return Inertia::render('dashboard', [
            'projects' => $projects->map(fn (Project $project): array => [
                'id' => $project->id,
                'name' => $project->name,
                'number' => $project->number,
                'client' => $project->client,
                'address' => $project->address,
                'units' => $project->units,
                'opened_at' => $project->opened_at?->toIso8601String(),
                'updated_at' => $project->updated_at?->toIso8601String(),
                'summary' => $project->documentSummary(),
                'preview' => in_array($project->id, $withPreviews, true)
                    ? $project->planPreview()
                    : null,
            ])->values(),
            'totals' => $this->totals($projects),
            'wallTypes' => $this->wallTypes($projects),
        ]);
    }

    /**
     * @param  Collection<int, Project>  $projects
     * @return array{projects: int, levels: int, walls: int, rooms: int, openings: int, wallLength: float, slabArea: float}
     */
    private function totals(Collection $projects): array
    {
        $summaries = $projects->map(fn (Project $project): array => $project->documentSummary());

        return [
            'projects' => $projects->count(),
            'levels' => (int) $summaries->sum('levels'),
            'walls' => (int) $summaries->sum('walls'),
            'rooms' => (int) $summaries->sum('rooms'),
            'openings' => (int) $summaries->sum('openings'),
            'wallLength' => (float) $summaries->sum('wallLength'),
            'slabArea' => (float) $summaries->sum('slabArea'),
        ];
    }

    /**
     * Wall length built from each type across the whole practice, longest first.
     *
     * @param  Collection<int, Project>  $projects
     * @return array<int, array{name: string, length: float}>
     */
    private function wallTypes(Collection $projects): array
    {
        $totals = [];

        foreach ($projects as $project) {
            foreach ($project->wallLengthByType() as $typeId => $type) {
                $totals[$typeId] ??= ['name' => $type['name'], 'length' => 0.0];
                $totals[$typeId]['length'] += $type['length'];
            }
        }

        usort($totals, fn (array $a, array $b): int => $b['length'] <=> $a['length']);

        return $totals;
    }
}
