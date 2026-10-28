<?php

namespace App\Actions;

use App\Models\Campaign;
use App\Models\CampaignInvite;
use App\Models\User;
use App\Realtime\ScenePublisher;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

class InviteActions
{
    public function create(User $user, Campaign $campaign, array $data): array
    {
        Gate::forUser($user)->authorize('update', $campaign);
        $raw = bin2hex(random_bytes(32));
        $invite = CampaignInvite::create(['campaign_id' => $campaign->id, 'created_by_user_id' => $user->id,
            'token_hash' => hash('sha256', $raw), 'expires_at' => now()->addDays($data['expiresInDays'] ?? 7),
            'max_uses' => $data['maxUses'] ?? null]);

        return $this->describe($invite) + ['url' => url('/join/'.$raw)];
    }

    public function describe(CampaignInvite $invite): array
    {
        return ['id' => (string) $invite->id, 'expiresAt' => $invite->expires_at?->toIso8601String(),
            'revokedAt' => $invite->revoked_at?->toIso8601String(), 'maxUses' => $invite->max_uses, 'usesCount' => $invite->uses_count];
    }

    public function inspect(string $raw): CampaignInvite
    {
        $invite = CampaignInvite::where('token_hash', hash('sha256', $raw))->first();
        if (! $invite) {
            throw ValidationException::withMessages(['invite' => 'This invitation is invalid. Ask your Game Master for a new link.']);
        }
        $this->validate($invite);

        return $invite;
    }

    private function validate(CampaignInvite $invite): void
    {
        if ($invite->revoked_at) {
            throw ValidationException::withMessages(['invite' => 'This invitation has been revoked.']);
        }
        if ($invite->expires_at?->isPast()) {
            throw ValidationException::withMessages(['invite' => 'This invitation has expired. Ask your Game Master for a new link.']);
        }
    }

    public function join(User $user, string $raw): Campaign
    {
        return DB::transaction(function () use ($user, $raw) {
            $invite = CampaignInvite::where('token_hash', hash('sha256', $raw))->lockForUpdate()->first();
            if (! $invite) {
                throw ValidationException::withMessages(['invite' => 'This invitation is invalid.']);
            }
            $this->validate($invite);
            $campaign = Campaign::whereKey($invite->campaign_id)->lockForUpdate()->firstOrFail();
            if ($campaign->roleFor($user)) {
                return $campaign;
            }
            if ($invite->max_uses !== null && $invite->uses_count >= $invite->max_uses) {
                throw ValidationException::withMessages(['invite' => 'This invitation has reached its join limit.']);
            }
            $campaign->members()->attach($user->id, ['role' => 'player']);
            $invite->increment('uses_count');
            app(ScenePublisher::class)->campaign($campaign);

            return $campaign;
        }, 3);
    }

    public function revoke(User $user, CampaignInvite $invite): void
    {
        Gate::forUser($user)->authorize('update', $invite->campaign);
        $invite->update(['revoked_at' => now()]);
    }
}
