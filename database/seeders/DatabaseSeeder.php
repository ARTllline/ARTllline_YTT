<?php

namespace Database\Seeders;

use App\Services\FantasyClassicPack;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        $pack = app(FantasyClassicPack::class);
        $pack->install();
        $pack->installEnvironment();
    }
}
