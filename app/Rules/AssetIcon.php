<?php

namespace App\Rules;

use App\Models\Asset;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Support\Facades\Gate;

/** Stable asset IDs travel with independent item/spell snapshots. */
class AssetIcon implements ValidationRule
{
    public function __construct(private array $builtins) {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (in_array($value, $this->builtins, true)) {
            return;
        }
        if (! is_string($value) || ! preg_match('/^asset:([1-9][0-9]*)$/D', $value, $match)) {
            $fail('Выберите изображение из своей библиотеки Assets.');

            return;
        }
        $asset = Asset::whereNull('duration_ms')->whereKey($match[1])->sharedLock()->first();
        if (! $asset || ! Gate::allows('view', $asset)) {
            $fail('Выберите изображение из своей библиотеки Assets.');
        }
    }
}
