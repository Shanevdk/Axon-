<?php

use App\Http\Controllers\AssistantController;
use App\Http\Controllers\ClientController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\MessageController;
use App\Http\Controllers\OrganizationController;
use App\Http\Controllers\OrganizationInvitationController;
use App\Http\Controllers\ProjectController;
use App\Http\Controllers\ProjectRenderController;
use Illuminate\Support\Facades\Route;

Route::inertia('/', 'welcome')->name('home');

// Guests follow this straight from their inbox, so it sits outside the wall.
Route::get('invitations/{token}', [OrganizationInvitationController::class, 'accept'])
    ->name('invitations.accept');

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
});

require __DIR__.'/settings.php';
