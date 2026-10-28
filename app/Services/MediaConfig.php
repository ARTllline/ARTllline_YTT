<?php

namespace App\Services;

use App\Models\Asset;
use Illuminate\Support\Facades\Validator;

class MediaConfig
{
    public const TYPES = ['music.start', 'music.stop', 'music.pause', 'music.resume', 'ambient.start', 'ambient.stop', 'sfx.play', 'audio.volume', 'atmosphere.start', 'atmosphere.stop'];

    public function validate(int $campaignId, string $type, array $input): array
    {
        $fade = ['fade' => 'required|integer|between:0,5000'];
        $rules = match ($type) {
            'music.start', 'ambient.start' => ['assetId' => 'required|integer|min:1', 'volume' => 'required|numeric|between:0,1', 'loop' => 'required|boolean'] + $fade,
            'sfx.play' => ['assetId' => 'required|integer|min:1', 'volume' => 'required|numeric|between:0,1'],
            'music.stop' => $fade,
            'ambient.stop' => ['assetId' => 'nullable|integer|min:1'] + $fade,
            'music.pause', 'music.resume' => [],
            'audio.volume' => ['channel' => 'required|in:music,ambient,sfx', 'volume' => 'required|numeric|between:0,1'],
            'atmosphere.start' => ['effect' => 'required|in:rain,snow,embers,haze', 'intensity' => 'required|in:light,medium,strong'],
            'atmosphere.stop' => ['effect' => 'required|in:rain,snow,embers,haze'],
            default => abort(422, 'Неизвестное действие звука или атмосферы.'),
        };
        $data = Validator::make($input, $rules, [], ['assetId' => 'аудиоматериал', 'volume' => 'громкость', 'fade' => 'переход', 'loop' => 'повтор', 'channel' => 'канал', 'effect' => 'эффект', 'intensity' => 'интенсивность'])->validate();
        if (isset($data['assetId'])) {
            $asset = Asset::where('campaign_id', $campaignId)->where('kind', explode('.', $type)[0])->find($data['assetId']);
            abort_unless($asset, 422, 'Аудиоматериал недоступен в этой кампании или имеет другой тип.');
            abort_if($type === 'sfx.play' && $asset->duration_ms > 120000, 422, 'Одноразовый звук ограничен двумя минутами. Используйте атмосферу для длинной записи.');
        }

        return $data;
    }
}
