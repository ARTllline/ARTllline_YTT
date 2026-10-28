<?php

namespace App\Services;

use App\Models\ContentTemplate;
use App\Models\Handout;
use App\Models\Scene;
use App\Models\SceneProp;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/** A closed action vocabulary, not executable user code. Also used before execution. */
class CueDefinition
{
    public const TYPES = ['objects.reveal', 'objects.hide', 'object.move', 'prefab.spawn', 'encounter.spawn',
        'combat.add', 'combat.begin', 'combat.end', 'combat.next', 'handout.show', 'message', 'wait',
        'camera.focus', 'camera.pan', 'camera.zoom', 'camera.shake', 'camera.fade', 'camera.release',
        'music.start', 'music.stop', 'ambient.start', 'ambient.stop', 'sfx.play', 'atmosphere.start', 'atmosphere.stop', 'screen.flash', 'screen.vignette'];

    public function validate(Scene $scene, array $input): array
    {
        $data = Validator::make($input, ['name' => 'required|string|max:160', 'description' => 'nullable|string|max:2000',
            'sort_order' => 'sometimes|integer|min:0|max:10000', 'steps' => 'required|array|min:1|max:50',
            'steps.*.type' => ['required', Rule::in(self::TYPES)], 'steps.*.config' => 'present|array'], [], [
                'name' => 'название', 'description' => 'описание', 'sort_order' => 'порядок', 'steps' => 'действия',
                'steps.*.type' => 'тип действия', 'steps.*.config' => 'настройки действия',
            ])->validate();
        $duration = 0;
        foreach ($data['steps'] as &$step) {
            $step = ['type' => $step['type'], 'config' => $this->config($scene, $step['type'], $step['config'])];
            $duration += $step['config']['duration'] ?? 0;
        }
        abort_if($duration > 600000, 422, 'Последовательность ограничена десятью минутами.');

        return $data;
    }

    public function config(Scene $scene, string $type, array $input): array
    {
        if (in_array($type, MediaConfig::TYPES)) {
            return app(MediaConfig::class)->validate($scene->campaign_id, $type, $input);
        }
        $point = ['x' => 'required|numeric|between:-1000000,1000000', 'y' => 'required|numeric|between:-1000000,1000000'];
        $duration = ['duration' => 'required|integer|between:0,10000'];
        $target = ['kind' => 'required|in:token,prop,point', 'id' => 'required_unless:kind,point|nullable|integer|min:1'];
        $rules = match ($type) {
            'objects.reveal', 'objects.hide' => ['tokenIds' => 'present|array|max:200', 'tokenIds.*' => 'integer|distinct|min:1', 'propIds' => 'present|array|max:200', 'propIds.*' => 'integer|distinct|min:1'],
            'object.move' => ['kind' => 'required|in:token,prop', 'id' => 'required|integer|min:1'] + $point,
            'prefab.spawn', 'encounter.spawn' => ['templateId' => 'required|integer|min:1', 'addToCombat' => 'sometimes|boolean', 'startCombat' => 'sometimes|boolean'] + $point,
            'combat.add' => ['tokenIds' => 'required|array|min:1|max:200', 'tokenIds.*' => 'integer|distinct|min:1'],
            'handout.show' => ['handoutId' => 'required|integer|min:1'],
            'message' => ['title' => 'nullable|string|max:160', 'text' => 'required|string|max:2000', 'duration' => 'required|integer|between:500,30000'],
            'wait' => ['duration' => 'required|integer|between:100,60000'],
            'camera.focus' => $target + ['x' => 'required_if:kind,point|numeric|between:-1000000,1000000', 'y' => 'required_if:kind,point|numeric|between:-1000000,1000000'] + $duration,
            'camera.pan' => $point + $duration,
            'camera.zoom' => ['zoom' => 'required|numeric|between:0.2,3'] + $duration,
            'camera.shake' => ['strength' => 'required|in:light,medium,strong'] + $duration,
            'camera.fade' => ['blackout' => 'required|boolean'] + $duration,
            'screen.flash', 'screen.vignette' => ['color' => ['required', 'regex:/^#[a-fA-F0-9]{6}$/'], 'duration' => 'required|integer|between:200,2000'],
            'combat.begin', 'combat.end', 'combat.next', 'camera.release' => [],
            default => abort(422, 'Неизвестное действие события.'),
        };
        $data = Validator::make($input, $rules, [], [
            'duration' => 'длительность', 'kind' => 'тип цели', 'id' => 'цель', 'x' => 'X', 'y' => 'Y',
            'tokenIds' => 'токены', 'tokenIds.*' => 'токен', 'propIds' => 'объекты', 'propIds.*' => 'объект',
            'templateId' => 'заготовка или столкновение', 'handoutId' => 'раздаточный материал',
            'addToCombat' => 'добавление в бой', 'startCombat' => 'начало боя', 'title' => 'заголовок',
            'text' => 'текст сообщения', 'zoom' => 'масштаб', 'strength' => 'сила встряски', 'blackout' => 'затемнение',
        ])->validate();
        if (isset($data['tokenIds']) || isset($data['propIds'])) {
            $tokens = $data['tokenIds'] ?? [];
            $props = $data['propIds'] ?? [];
            abort_if(count($tokens) + count($props) < 1 || count($tokens) + count($props) > 200, 422, 'Выберите от 1 до 200 объектов.');
            abort_unless($scene->tokens()->whereIn('id', $tokens)->count() === count($tokens)
                && SceneProp::where('scene_id', $scene->id)->whereIn('id', $props)->count() === count($props), 422, 'Объект больше не существует в этой сцене.');
        }
        if (isset($data['kind']) && $data['kind'] !== 'point') {
            $query = $data['kind'] === 'token' ? $scene->tokens() : SceneProp::where('scene_id', $scene->id);
            abort_unless($query->whereKey($data['id'])->exists(), 422, 'Цель больше не существует в этой сцене.');
        }
        if (isset($data['templateId'])) {
            abort_unless(ContentTemplate::where('campaign_id', $scene->campaign_id)->where('kind', $type === 'prefab.spawn' ? 'prefab' : 'encounter')->whereKey($data['templateId'])->exists(), 422, 'Заготовка или столкновение недоступны.');
        }
        if (isset($data['handoutId'])) {
            abort_unless(Handout::where('campaign_id', $scene->campaign_id)->whereKey($data['handoutId'])->exists(), 422, 'Материал недоступен в этой кампании.');
        }

        return $data;
    }
}
