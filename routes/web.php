<?php

use App\Http\Controllers\AssetController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\CampaignController;
use App\Http\Controllers\SceneController;
use App\Http\Controllers\TokenController;
use App\Http\Controllers\WorkspaceController;
use App\Http\Middleware\PrivateResponse;
use Illuminate\Support\Facades\Route;

Route::view('/login', 'workspace')->name('login');
Route::view('/register', 'workspace');
Route::middleware('auth')->group(function () {
    Route::view('/', 'workspace');
    Route::get('/campaigns/{campaign}', [WorkspaceController::class, 'campaign']);
    Route::get('/campaigns/{campaign}/scenes/{scene}', [WorkspaceController::class, 'scene']);
});

// Same-origin HTTP API intentionally stays in the web middleware group: sessions + CSRF.
Route::prefix('api')->middleware(PrivateResponse::class)->group(function () {
    Route::get('/session', [AuthController::class, 'session']);
    Route::middleware(['guest', 'throttle:10,1'])->group(function () {
        Route::post('/register', [AuthController::class, 'register']);
        Route::post('/login', [AuthController::class, 'login']);
    });
    Route::middleware('auth')->group(function () {
        Route::post('/logout', [AuthController::class, 'logout']);
        Route::get('/campaigns', [CampaignController::class, 'index']);
        Route::post('/campaigns', [CampaignController::class, 'store']);
        Route::get('/campaigns/{campaign}', [CampaignController::class, 'show']);
        Route::patch('/campaigns/{campaign}', [CampaignController::class, 'update']);
        Route::post('/campaigns/{campaign}/activate', [CampaignController::class, 'activate']);
        Route::post('/campaigns/{campaign}/scenes', [SceneController::class, 'store']);
        Route::get('/scenes/{scene}/snapshot', [SceneController::class, 'snapshot']);
        Route::patch('/scenes/{scene}', [SceneController::class, 'update']);
        Route::put('/scenes/{scene}/grid', [SceneController::class, 'grid']);
        Route::put('/scenes/{scene}/map', [SceneController::class, 'map']);
        Route::delete('/scenes/{scene}', [SceneController::class, 'destroy']);
        Route::post('/scenes/{scene}/tokens', [TokenController::class, 'store']);
        Route::post('/tokens/{token}/move', [TokenController::class, 'move']);
        Route::patch('/tokens/{token}', [TokenController::class, 'update']);
        Route::delete('/tokens/{token}', [TokenController::class, 'destroy']);
        Route::post('/campaigns/{campaign}/assets', [AssetController::class, 'store'])->middleware('throttle:30,1');
        Route::get('/assets/{asset}', [AssetController::class, 'show']);
    });
});
