<?php

use Illuminate\Support\Facades\DB;
use MongoDB\Driver\Exception\Exception as MongoDriverException;
use MongoDB\Laravel\Connection;

test('mongo sits beside the relational core, never instead of it', function () {
    expect(config('database.connections.mongodb.driver'))->toBe('mongodb')
        ->and(config('database.connections.mongodb.dsn'))->toStartWith('mongodb')
        ->and(config('database.connections.mongodb.database'))->not->toBeEmpty()
        // The app's records stay on the default relational connection.
        ->and(config('database.default'))->not->toBe('mongodb');
});

test('the mongodb driver resolves through the database manager', function () {
    // Connections are lazy — resolving one proves the driver and extension
    // are wired up without needing a server to answer.
    expect(DB::connection('mongodb'))->toBeInstanceOf(Connection::class);
});

test('a reachable server answers a ping', function () {
    // Fail fast rather than sitting out the driver's 30 second default.
    config(['database.connections.mongodb.options.serverSelectionTimeoutMS' => 1000]);
    DB::purge('mongodb');

    try {
        $reply = DB::connection('mongodb')
            ->getDatabase()
            ->command(['ping' => 1])
            ->toArray();
    } catch (MongoDriverException) {
        $this->markTestSkipped('No MongoDB server is reachable here.');
    }

    expect($reply[0]->ok)->toEqual(1.0);
});
