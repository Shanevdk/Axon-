<?php

use App\Http\Controllers\AiConnectionController;
use App\Http\Controllers\AssistantController;
use App\Http\Controllers\ChatController;
use App\Http\Controllers\ClaudeAccountController;
use App\Http\Controllers\ClientController;
use App\Http\Controllers\ClientPortalController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\LibraryItemController;
use App\Http\Controllers\MeetingController;
use App\Http\Controllers\MessageController;
use App\Http\Controllers\NoteController;
use App\Http\Controllers\OrganizationController;
use App\Http\Controllers\OrganizationInvitationController;
use App\Http\Controllers\ProjectAssistantController;
use App\Http\Controllers\ProjectController;
use App\Http\Controllers\ProjectRenderController;
use App\Http\Controllers\ProjectSiteController;
use Illuminate\Support\Facades\Route;

Route::inertia('/', 'welcome')->name('home');

// Guests follow this straight from their inbox, so it sits outside the wall.
// There is no public sign-up: an invitation link is the only way an account
// comes to exist, and these two pages are where it happens.
Route::get('invitations/{token}', [OrganizationInvitationController::class, 'accept'])
    ->name('invitations.accept');

/*
 * The client portal.
 *
 * Clients hold a number, not an account, so none of this sits behind `auth`.
 * Everything past the door is read-only bar the comment box — there is no
 * route from here that writes a drawing.
 */
Route::prefix('portal')->name('portal.')->group(function () {
    Route::get('/', [ClientPortalController::class, 'enter'])->name('enter');

    // The number is the whole credential, so guessing at it is rationed.
    Route::post('/', [ClientPortalController::class, 'open'])
        ->middleware('throttle:5,1')
        ->name('open');

    Route::middleware('portal')->group(function () {
        Route::get('progress', [ClientPortalController::class, 'show'])->name('show');
        Route::get('drawings/{project}/tour', [ClientPortalController::class, 'tour'])->name('tour');
        Route::post('comments', [ClientPortalController::class, 'comment'])->name('comments.store');
        Route::post('leave', [ClientPortalController::class, 'leave'])->name('leave');
    });
});

Route::get('set-up', [OrganizationInvitationController::class, 'setUp'])
    ->name('invitations.setup');

Route::post('set-up', [OrganizationInvitationController::class, 'open'])
    ->middleware('throttle:10,1')
    ->name('invitations.open');

Route::middleware(['auth', 'verified'])->group(function () {
    Route::get('dashboard', [DashboardController::class, 'index'])->name('dashboard');

    Route::resource('projects', ProjectController::class)->except(['create', 'edit']);

    Route::get('assistant', [AssistantController::class, 'index'])->name('assistant');

    // Free models are rate limited upstream, so the queue is held back here first.
    Route::post('assistant', [AssistantController::class, 'reply'])
        ->middleware('throttle:20,1')
        ->name('assistant.reply');

    Route::get('organization', [OrganizationController::class, 'show'])->name('organization.show');
    Route::post('organization', [OrganizationController::class, 'store'])->name('organization.store');
    Route::put('organization', [OrganizationController::class, 'update'])->name('organization.update');
    Route::delete('organization', [OrganizationController::class, 'destroy'])->name('organization.destroy');
    Route::post('organization/join', [OrganizationController::class, 'join'])->name('organization.join');
    Route::post('organization/code', [OrganizationController::class, 'regenerateCode'])
        ->name('organization.code.regenerate');
    Route::post('organization/leave', [OrganizationController::class, 'leave'])->name('organization.leave');
    Route::post('organization/messages', [MessageController::class, 'store'])->name('organization.messages.store');

    // The conversation gets a room of its own, with everyone's status on the wall.
    Route::get('chat', [ChatController::class, 'index'])->name('chat');
    Route::put('chat/status', [ChatController::class, 'updateStatus'])->name('chat.status');

    Route::post('organization/invitations', [OrganizationInvitationController::class, 'store'])
        ->name('organization.invitations.store');
    Route::post('organization/invitations/{invitation}/resend', [OrganizationInvitationController::class, 'resend'])
        ->name('organization.invitations.resend');
    Route::delete('organization/invitations/{invitation}', [OrganizationInvitationController::class, 'destroy'])
        ->name('organization.invitations.destroy');
    Route::post('invitations/{invitation}/accept', [OrganizationInvitationController::class, 'claim'])
        ->name('invitations.claim');
    Route::delete('invitations/{invitation}', [OrganizationInvitationController::class, 'decline'])
        ->name('invitations.decline');

    Route::resource('clients', ClientController::class)->only(['index', 'store', 'update', 'destroy']);

    // The model library. The designer and feed routes sit above the
    // wildcard so their paths are never read as an item id.
    Route::get('library', [LibraryItemController::class, 'index'])->name('library.index');
    Route::get('library/designer', [LibraryItemController::class, 'designer'])->name('library.designer');

    // The designer's AI box: drafts cost whoever's key is connected, so the
    // pace is held here too.
    Route::post('library/draft', [LibraryItemController::class, 'draft'])
        ->middleware('throttle:20,1')
        ->name('library.draft');

    Route::post('library/terminal', [LibraryItemController::class, 'terminal'])
        ->middleware('throttle:20,1')
        ->name('library.terminal');

    // Claude Code on this machine, answering in the page.
    Route::post('library/claude', [LibraryItemController::class, 'claudeCode'])
        ->middleware('throttle:20,1')
        ->name('library.claude');

    // The board Claude Code shares with the designer. Polled every couple of
    // seconds while the bridge is open, so it is held looser than the rest.
    Route::post('library/board', [LibraryItemController::class, 'board'])
        ->middleware('throttle:120,1')
        ->name('library.board');

    // Signing in with your own Claude account. Everything that drives the CLI
    // — the designer's terminal and the editor's sidebar — is gated on this,
    // because a turn spends a subscription and it must be the asker's own.
    // Verifying costs a real turn, so the pace is tight.
    Route::post('claude-account', [ClaudeAccountController::class, 'store'])
        ->middleware('throttle:6,1')
        ->name('claude-account.store');

    Route::delete('claude-account', [ClaudeAccountController::class, 'destroy'])
        ->name('claude-account.destroy');

    Route::post('ai-connections', [AiConnectionController::class, 'store'])->name('ai-connections.store');
    Route::delete('ai-connections/{aiConnection}', [AiConnectionController::class, 'destroy'])
        ->name('ai-connections.destroy');
    Route::get('library/feed', [LibraryItemController::class, 'feed'])->name('library.feed');
    Route::get('library/{libraryItem}/payload', [LibraryItemController::class, 'payload'])->name('library.payload');
    Route::post('library', [LibraryItemController::class, 'store'])->name('library.store');
    Route::put('library/{libraryItem}', [LibraryItemController::class, 'update'])->name('library.update');
    Route::patch('library/{libraryItem}', [LibraryItemController::class, 'rename'])->name('library.rename');
    Route::delete('library/{libraryItem}', [LibraryItemController::class, 'destroy'])->name('library.destroy');

    Route::resource('notes', NoteController::class)->only(['index', 'store', 'update', 'destroy']);

    Route::patch('notes/{note}/pin', [NoteController::class, 'pin'])->name('notes.pin');

    // The diary reads as a wall calendar, so its page keeps a plainer name
    // than the bookings it holds.
    Route::get('calendar', [MeetingController::class, 'index'])->name('calendar');

    Route::resource('meetings', MeetingController::class)->only(['store', 'update', 'destroy']);

    Route::post('clients/{client}/portal-number', [ClientController::class, 'reissueNumber'])
        ->name('clients.portal-number.reissue');

    Route::post('clients/{client}/projects', [ClientController::class, 'assign'])
        ->name('clients.projects.assign');
    Route::delete('clients/{client}/projects/{project}', [ClientController::class, 'unassign'])
        ->name('clients.projects.unassign');

    Route::put('projects/{project}/document', [ProjectController::class, 'updateDocument'])
        ->name('projects.document.update');

    // Each render is a call out to a free, shared generator, so the pace is held here.
    Route::post('projects/{project}/render', [ProjectRenderController::class, 'store'])
        ->middleware('throttle:12,1')
        ->name('projects.render');

    // The code consultant that sits inside the editor. Same free model as the
    // general assistant, so the same pace.
    Route::post('projects/{project}/assistant', [ProjectAssistantController::class, 'reply'])
        ->middleware('throttle:20,1')
        ->name('projects.assistant.reply');

    // Claude in the editor's sidebar, holding this app's own MCP server, so a
    // turn can draw rather than only describe. It runs a local CLI and a build
    // turn moves the whole drawing twice, so it is paced well below the rest.
    Route::post('projects/{project}/claude', [ProjectAssistantController::class, 'claude'])
        ->middleware('throttle:12,1')
        ->name('projects.claude');

    Route::put('projects/{project}/jurisdiction', [ProjectAssistantController::class, 'updateJurisdiction'])
        ->name('projects.jurisdiction.update');

    // Address search for the site picker. Nominatim asks for no more than a
    // request a second, so this is the tightest limit of the borrowed
    // services — the picker waits for a pause in typing before it asks.
    Route::get('site/places', [ProjectSiteController::class, 'places'])
        ->middleware('throttle:30,1')
        ->name('site.places');

    // Reading the height of the land off a free, shared elevation service, so
    // the same pace as the other borrowed services. Answers are cached for a
    // month, which is generous for ground that took an ice age to get there.
    Route::post('projects/{project}/site/ground', [ProjectSiteController::class, 'ground'])
        ->middleware('throttle:20,1')
        ->name('projects.site.ground');

    // Turning "use my location" into a place name, held back because it calls
    // a free, shared geocoder.
    Route::post('assistant/place', [AssistantController::class, 'place'])
        ->middleware('throttle:20,1')
        ->name('assistant.place');
});

require __DIR__.'/settings.php';
