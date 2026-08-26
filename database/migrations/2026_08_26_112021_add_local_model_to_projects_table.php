<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Drawings move onto the machines that draw them.
 *
 * `document` stops holding the whole model and starts holding a preview of
 * one level, which is all the projects page needs. Because a preview cannot
 * be counted, the counts move into their own column, written by the editor
 * from the full model.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('projects', function (Blueprint $table) {
            // False means `document` is still the whole model and the browser
            // should adopt it. Existing projects therefore migrate themselves
            // the first time each is opened.
            $table->boolean('has_local_model')->default(false)->after('document');
            $table->json('summary')->nullable()->after('has_local_model');
        });
    }

    public function down(): void
    {
        Schema::table('projects', function (Blueprint $table) {
            $table->dropColumn(['has_local_model', 'summary']);
        });
    }
};
