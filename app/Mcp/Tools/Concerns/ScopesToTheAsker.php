<?php

namespace App\Mcp\Tools\Concerns;

use App\Models\DesignBoard;
use App\Models\LibraryItem;
use App\Models\Project;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Laravel\Mcp\Response;

/**
 * Who is asking, and what they are allowed to see.
 *
 * This server is reached three ways, and only one of them used to be true.
 * Over HTTP it is a connector: somebody added Vanhaven to Claude and is
 * carrying an OAuth token, and their studio's work is the only work they may
 * touch. Over stdio it is either the editor's sidebar — which says who it is
 * acting for — or a developer running `php artisan mcp:start cad` by hand on
 * their own machine against their own database.
 *
 * Every tool asks here rather than querying a model directly. A tool that
 * writes `Project::query()->find(...)` has no idea whose project it found,
 * which over HTTP means handing one studio another studio's building.
 */
trait ScopesToTheAsker
{
    /**
     * The person this turn is being taken for, if anybody.
     *
     * Null means a hand-run local server: no token, nobody named. That is a
     * developer on their own machine, so it is left alone — but it is the
     * only case that is, and {@see everyoneIsAllowed()} is where that is
     * decided rather than being spread through twelve tools.
     */
    protected function asker(): ?User
    {
        // The connector's token guard first, by name. The default guard is
        // the session one, which a request carrying only a bearer token has
        // never touched.
        foreach (['api', null] as $guard) {
            $signedIn = auth($guard)->user();

            if ($signedIn instanceof User) {
                return $signedIn;
            }
        }

        // The sidebar spawns this server as a subprocess and names the person
        // it is acting for, because a subprocess has no session to read.
        $named = getenv('VANHAVEN_MCP_USER');

        return $named === false || $named === ''
            ? null
            : User::query()->find((int) $named);
    }

    /**
     * Whether an unidentified caller may see everything.
     *
     * True only for a local stdio server started by hand — the person who
     * can run that command already has the database. Over HTTP a caller is
     * always identified, because the route is behind a token guard; if that
     * ever stops being true this returns false and the tools go quiet rather
     * than generous.
     */
    protected function everyoneIsAllowed(): bool
    {
        // Console means stdio: `php artisan mcp:start cad`, run by somebody
        // with a shell on the machine and therefore with the database. Over
        // HTTP this is false, so an unnamed caller sees nothing — and an
        // unnamed caller should be impossible there anyway, since the route
        // is behind a token guard. This is the belt to that guard's braces.
        return app()->runningInConsole();
    }

    /**
     * The projects this caller may work on.
     *
     * @return Builder<Project>
     */
    protected function visibleProjects(): Builder
    {
        $asker = $this->asker();

        if ($asker !== null) {
            return $asker->teamProjects();
        }

        return $this->everyoneIsAllowed()
            ? Project::query()
            // Matches nothing rather than everything: a caller we cannot name
            // gets no drawings, not all of them.
            : Project::query()->whereRaw('1 = 0');
    }

    /**
     * The library items this caller may reach.
     *
     * @return Builder<LibraryItem>
     */
    protected function visibleLibraryItems(): Builder
    {
        $asker = $this->asker();

        if ($asker !== null) {
            return $asker->teamLibraryItems();
        }

        return $this->everyoneIsAllowed()
            ? LibraryItem::query()
            : LibraryItem::query()->whereRaw('1 = 0');
    }

    /**
     * The design boards this caller may work.
     *
     * A board is one person's item designer open in their browser, so it is
     * scoped to them alone rather than to the team — two people designing at
     * once must not land on each other's board.
     *
     * @return Builder<DesignBoard>
     */
    protected function visibleDesignBoards(): Builder
    {
        $asker = $this->asker();

        if ($asker !== null) {
            return DesignBoard::query()->where('user_id', $asker->id);
        }

        return $this->everyoneIsAllowed()
            ? DesignBoard::query()
            : DesignBoard::query()->whereRaw('1 = 0');
    }

    /**
     * The one answer for a project this caller cannot have.
     *
     * Deliberately the same wording whether the project does not exist or
     * belongs to another studio. Two different messages would let a caller
     * learn which ids are real by asking for all of them.
     */
    protected function refuseUnknownProject(): Response
    {
        return Response::error(
            'No project with that id is open to you. Call list-projects to see the ones that are.'
        );
    }

    /**
     * The same, for an item on the library shelf.
     */
    protected function refuseUnknownItem(): Response
    {
        return Response::error(
            'No library item with that id is open to you. Call list-library-items to see the ones that are.'
        );
    }
}
