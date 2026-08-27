<?php

use App\Models\User;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * The model library: reusable items the whole studio can place. The
     * payload is the triangle mesh (plus the part list when the item was
     * designed in Axon), and the thumbnail is a small SVG drawn in the
     * browser when the item was saved.
     */
    public function up(): void
    {
        Schema::create('library_items', function (Blueprint $table) {
            $table->id();
            $table->foreignIdFor(User::class)->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('category');
            $table->string('kind'); // imported | designed
            $table->text('thumbnail');
            $table->json('payload');
            $table->unsignedInteger('triangles')->default(0);
            $table->timestamps();

            $table->index(['user_id', 'category', 'name']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('library_items');
    }
};
