<?php

namespace App\Services;

use Illuminate\Http\UploadedFile;
use Illuminate\Validation\ValidationException;
use Symfony\Component\Process\Process;

class AudioProbe
{
    public function inspect(UploadedFile $file): array
    {
        $fail = fn () => throw ValidationException::withMessages(['file' => 'Используйте MP3, OGG (Vorbis/Opus) или WAV (PCM 16/24 бит), до 64 МБ и 2 часов.']);
        if ($file->getSize() > 64 * 1024 * 1024) {
            $fail();
        }
        // No shell interpolation, network protocols, playlists or user-supplied options.
        $process = new Process([config('media.ffprobe'), '-v', 'error', '-protocol_whitelist', 'file', '-show_entries', 'format=format_name,duration:stream=codec_type,codec_name,sample_rate,channels', '-of', 'json', $file->getRealPath()]);
        $process->setTimeout(10);
        try {
            $process->mustRun();
        } catch (\Throwable $error) {
            report($error);
            throw ValidationException::withMessages(['file' => 'Не удалось проверить аудио. Проверьте файл и доступность FFprobe на сервере.']);
        }
        $info = json_decode($process->getOutput(), true);
        $streams = $info['streams'] ?? [];
        $codec = $streams[0]['codec_name'] ?? '';
        $format = $info['format']['format_name'] ?? '';
        $duration = (float) ($info['format']['duration'] ?? 0);
        $mime = $file->getMimeType();
        $result = match (true) {
            $format === 'mp3' && $codec === 'mp3' && in_array($mime, ['audio/mpeg', 'audio/mp3']) => ['audio/mpeg', 'mp3'],
            $format === 'ogg' && in_array($codec, ['vorbis', 'opus']) && in_array($mime, ['audio/ogg', 'application/ogg']) => ['audio/ogg', 'ogg'],
            $format === 'wav' && in_array($codec, ['pcm_s16le', 'pcm_s24le']) && in_array($mime, ['audio/x-wav', 'audio/wav', 'audio/vnd.wave']) => ['audio/wav', 'wav'],
            default => null,
        };
        if (! $result || count($streams) !== 1 || ($streams[0]['codec_type'] ?? '') !== 'audio'
            || ($streams[0]['channels'] ?? 0) < 1 || $streams[0]['channels'] > 2
            || $duration <= 0 || $duration > 7200 || ! is_finite($duration)) {
            $fail();
        }

        return ['mime' => $result[0], 'extension' => $result[1], 'duration' => (int) round($duration * 1000)];
    }
}
