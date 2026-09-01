<?php

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
        Schema::table('projects', function (Blueprint $table) {
            // The house as the client sees it: every level, but only what is
            // actually built. `document` stays a one-level thumbnail preview
            // once the model lives on somebody's machine, which is too little
            // to walk through and the wrong shape to widen.
            $table->json('client_model')->nullable()->after('document');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('projects', function (Blueprint $table) {
            $table->dropColumn('client_model');
        });
    }
};
