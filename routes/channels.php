<?php

use App\Models\User;
use App\Realtime\ChannelAccess;
use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('campaign.{campaign}', fn (User $user, string $campaign) => app(ChannelAccess::class)->presence($user, $campaign));
Broadcast::channel('campaign.{campaign}.control', fn (User $user, string $campaign) => (bool) app(ChannelAccess::class)->presence($user, $campaign));
Broadcast::channel('campaign.{campaign}.handouts.user.{participant}', fn (User $user, string $campaign, string $participant) => (string) $user->id === $participant && (bool) app(ChannelAccess::class)->presence($user, $campaign));
Broadcast::channel('campaign.{campaign}.scene.{scene}.gm', fn (User $user, string $campaign, string $scene) => app(ChannelAccess::class)->scene($user, $campaign, $scene));
Broadcast::channel('campaign.{campaign}.scene.{scene}.epoch.{epoch}.user.{participant}', fn (User $user, string $campaign, string $scene, string $epoch, string $participant) => app(ChannelAccess::class)->scene($user, $campaign, $scene, $epoch, $participant));
