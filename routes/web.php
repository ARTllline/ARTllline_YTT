<?php

use App\Http\Controllers\AssetController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\CampaignController;
use App\Http\Controllers\CombatController;
use App\Http\Controllers\CueController;
use App\Http\Controllers\FogController;
use App\Http\Controllers\HandoutController;
use App\Http\Controllers\InviteController;
use App\Http\Controllers\MediaController;
use App\Http\Controllers\MovePreviewController;
use App\Http\Controllers\NoteController;
use App\Http\Controllers\ObjectController;
use App\Http\Controllers\SceneController;
use App\Http\Controllers\SpatialController;
use App\Http\Controllers\TemplateController;
use App\Http\Controllers\TokenController;
use App\Http\Controllers\WorkspaceController;
use App\Http\Middleware\IdempotentMutation;
use App\Http\Middleware\PrivateResponse;
use App\Models\Scene;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Route;

Route::view('/login', 'workspace')->name('login');
Route::view('/register', 'workspace');
Route::view('/join/{inviteToken}', 'workspace')->where('inviteToken', '[a-f0-9]{64}');
Route::middleware('auth')->group(function () {
    Route::view('/', 'workspace');
    Route::get('/campaigns/{campaign}', [WorkspaceController::class, 'campaign']);
    Route::get('/campaigns/{campaign}/play', [WorkspaceController::class, 'play']);
    Route::get('/campaigns/{campaign}/scenes/{scene}', [WorkspaceController::class, 'scene']);
});

// Same-origin HTTP API intentionally stays in the web middleware group: sessions + CSRF.
Route::prefix('api')->middleware(PrivateResponse::class)->group(function () {
    Route::get('/session', [AuthController::class, 'session']);
    Route::get('/invites/{inviteToken}', [InviteController::class, 'show'])->middleware('throttle:30,1');
    Route::middleware(['guest', 'throttle:10,1'])->group(function () {
        Route::post('/register', [AuthController::class, 'register']);
        Route::post('/login', [AuthController::class, 'login']);
    });
    Route::middleware('auth')->group(function () {
        Route::get('/campaigns/{campaign}/media', [MediaController::class, 'show']);
        Route::post('/campaigns/{campaign}/media', [MediaController::class, 'command'])->name('campaign.media')->middleware([IdempotentMutation::class, 'throttle:120,1']);
        Route::get('/scenes/{scene}/cues', [CueController::class, 'index']);
        foreach (['save', 'delete', 'start', 'cancel', 'retry'] as $command) {
            Route::post('/scenes/{scene}/cues/'.$command, [CueController::class, 'command'])
                ->defaults('command', $command)->name('scene.cue.'.$command)->middleware(IdempotentMutation::class);
        }
        Route::post('/scenes/{scene}/props', [ObjectController::class, 'prop'])->name('scene.props')->middleware(IdempotentMutation::class);
        Route::post('/scenes/{scene}/selection', [ObjectController::class, 'selection'])->name('scene.selection')->middleware(IdempotentMutation::class);
        Route::post('/scenes/{scene}/spawn', [ObjectController::class, 'spawn'])->name('scene.spawn')->middleware(IdempotentMutation::class);
        Route::get('/campaigns/{campaign}/templates', [TemplateController::class, 'index']);
        Route::post('/campaigns/{campaign}/templates', [TemplateController::class, 'store'])->name('campaign.template.save')->middleware(IdempotentMutation::class);
        Route::post('/campaigns/{campaign}/templates/delete', [TemplateController::class, 'destroy'])->name('campaign.template.delete')->middleware(IdempotentMutation::class);
        Route::get('/campaigns/{campaign}/assets', [AssetController::class, 'index']);
        Route::get('/assets/{asset}/detail', [AssetController::class, 'detail']);
        Route::get('/assets/{asset}/thumbnail', [AssetController::class, 'thumbnail']);
        Route::patch('/assets/{asset}', [AssetController::class, 'update']);
        Route::delete('/assets/{asset}', [AssetController::class, 'destroy']);
        Route::get('/campaigns/{campaign}/handouts', [HandoutController::class, 'index']);
        Route::post('/campaigns/{campaign}/handouts', [HandoutController::class, 'store'])->name('campaign.handout.save')->middleware(IdempotentMutation::class);
        Route::post('/campaigns/{campaign}/handouts/show', [HandoutController::class, 'show'])->name('campaign.handout.show')->middleware(IdempotentMutation::class);
        Route::post('/scenes/{scene}/notes', NoteController::class)->name('scene.notes')->middleware(IdempotentMutation::class);
        foreach (['prepare', 'add', 'remove', 'initiative', 'sort', 'reorder', 'begin', 'next', 'previous', 'current', 'end'] as $command) {
            Route::post('/scenes/{scene}/combat/'.$command, [CombatController::class, 'combat'])->defaults('command', $command)->name('scene.combat.'.$command)->middleware(IdempotentMutation::class);
        }
        foreach (['hp', 'condition-add', 'condition-remove', 'condition-visibility'] as $command) {
            Route::post('/tokens/{token}/'.$command, [CombatController::class, 'token'])->defaults('command', $command)->name('token.'.$command)->middleware(IdempotentMutation::class);
        }
        Route::get('/campaigns/{campaign}/invites', [InviteController::class, 'index']);
        Route::post('/campaigns/{campaign}/invites', [InviteController::class, 'store'])->middleware('throttle:20,1');
        Route::delete('/invites/{invite}', [InviteController::class, 'revoke']);
        Route::post('/invites/{inviteToken}/join', [InviteController::class, 'join'])->middleware('throttle:20,1');
        Route::post('/tokens/{token}/preview', MovePreviewController::class)->middleware('throttle:preview');
        Route::post('/logout', [AuthController::class, 'logout']);
        Route::get('/campaigns', [CampaignController::class, 'index']);
        Route::post('/campaigns', [CampaignController::class, 'store']);
        Route::get('/campaigns/{campaign}', [CampaignController::class, 'show']);
        Route::patch('/campaigns/{campaign}', [CampaignController::class, 'update']);
        Route::post('/campaigns/{campaign}/activate', [CampaignController::class, 'activate'])->name('scene.activate')->middleware(IdempotentMutation::class);
        Route::post('/campaigns/{campaign}/scenes', [SceneController::class, 'store'])->name('scene.create')->middleware(IdempotentMutation::class);
        Route::post('/scenes/{scene}/fog/actions', [FogController::class, 'store'])->name('scene.fog.action')->middleware(IdempotentMutation::class);
        Route::post('/scenes/{scene}/fog/reset', [FogController::class, 'reset'])->name('scene.fog.reset')->middleware(IdempotentMutation::class);
        Route::post('/scenes/{scene}/spatial', SpatialController::class)->middleware('throttle:spatial');
        Route::get('/scenes/{scene}/snapshot', [SceneController::class, 'snapshot']);
        Route::get('/scenes/{scene}/revision', function (Scene $scene) {
            Gate::authorize('view', $scene);

            return ['revision' => $scene->revision];
        });
        Route::patch('/scenes/{scene}', [SceneController::class, 'update'])->name('scene.update')->middleware(IdempotentMutation::class);
        Route::put('/scenes/{scene}/grid', [SceneController::class, 'grid'])->name('scene.grid')->middleware(IdempotentMutation::class);
        Route::put('/scenes/{scene}/map', [SceneController::class, 'map'])->name('scene.map')->middleware(IdempotentMutation::class);
        Route::delete('/scenes/{scene}', [SceneController::class, 'destroy'])->name('scene.delete')->middleware(IdempotentMutation::class);
        Route::post('/scenes/{scene}/tokens', [TokenController::class, 'store'])->name('scene.tokens')->middleware(IdempotentMutation::class);
        Route::post('/tokens/{token}/move', [TokenController::class, 'move'])->name('token.move')->middleware(IdempotentMutation::class);
        Route::patch('/tokens/{token}', [TokenController::class, 'update'])->name('token.update')->middleware(IdempotentMutation::class);
        Route::delete('/tokens/{token}', [TokenController::class, 'destroy'])->name('token.delete')->middleware(IdempotentMutation::class);
        Route::post('/campaigns/{campaign}/assets', [AssetController::class, 'store'])->middleware('throttle:30,1');
        Route::get('/assets/{asset}', [AssetController::class, 'show']);
    });
});
