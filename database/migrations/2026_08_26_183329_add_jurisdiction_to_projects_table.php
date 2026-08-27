<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Where the building is, in the sense a code official would mean it —
     * "Kelowna, British Columbia, Canada" — kept apart from the street
     * address because it decides which code is in force, not where the post
     * goes.
     */
    public function up(): void
    {
        Schema::table('projects', function (Blueprint $table) {
            $table->string('jurisdiction')->nullable()->after('address');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('projects', function (Blueprint $table) {
            $table->dropColumn('jurisdiction');
        });
    }
};
