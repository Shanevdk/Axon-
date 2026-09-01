<?php

use App\Models\Client;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('clients', function (Blueprint $table) {
            $table->string('portal_username')->nullable()->unique()->after('name');
            $table->string('portal_number', 20)->nullable()->unique()->after('portal_username');
            $table->timestamp('portal_seen_at')->nullable()->after('portal_number');
        });

        // Clients on the register before the portal existed still need to be
        // able to sign in, so they are issued credentials here rather than
        // waiting to be edited.
        Client::query()->whereNull('portal_number')->eachById(function (Client $client): void {
            $client->forceFill([
                'portal_username' => Client::generatePortalUsername($client->name),
                'portal_number' => Client::generatePortalNumber(),
            ])->saveQuietly();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('clients', function (Blueprint $table) {
            $table->dropUnique(['portal_username']);
            $table->dropUnique(['portal_number']);
            $table->dropColumn(['portal_username', 'portal_number', 'portal_seen_at']);
        });
    }
};
