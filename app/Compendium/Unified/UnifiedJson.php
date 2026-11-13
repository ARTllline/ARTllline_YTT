<?php

namespace App\Compendium\Unified;

use InvalidArgumentException;

/** The export is JSON in known wrappers, never a JavaScript program. */
class UnifiedJson
{
    public function read(string $path, ?string $wrapper = null, int $limit = 16777216): array
    {
        $handle = @fopen($path, 'rb');
        if ($handle === false) {
            throw new InvalidArgumentException('Cannot read input file.');
        }
        try {
            $text = stream_get_contents($handle, $limit + 1);
        } finally {
            fclose($handle);
        }
        if ($text === false || strlen($text) > $limit) {
            throw new InvalidArgumentException('Input exceeds size limit.');
        }
        $text = trim($text);
        if ($wrapper !== null) {
            if (! str_starts_with($text, $wrapper.'(') || ! str_ends_with($text, ');')) {
                throw new InvalidArgumentException('Unexpected JSON wrapper.');
            }
            $text = substr($text, strlen($wrapper) + 1, -2);
        }
        $data = json_decode($text, true, 128, JSON_THROW_ON_ERROR);
        if (! is_array($data) || ! str_starts_with(ltrim($text), '{')) {
            throw new InvalidArgumentException('Expected a JSON object.');
        }
        $this->rejectDuplicateKeys($text);

        return $data;
    }

    public function inside(string $root, string $relative): string
    {
        if (! preg_match('~^[a-zA-Z0-9_./-]+$~D', $relative) || str_contains($relative, '..') || str_starts_with($relative, '/')) {
            throw new InvalidArgumentException('Unsafe relative path.');
        }
        $base = realpath($root);
        $path = realpath($root.DIRECTORY_SEPARATOR.$relative);
        if ($base === false || $path === false || ! is_file($path) || ! str_starts_with(strtolower($path), strtolower($base.DIRECTORY_SEPARATOR))) {
            throw new InvalidArgumentException('Missing file or path outside export root.');
        }

        return $path;
    }

    private function rejectDuplicateKeys(string $text): void
    {
        // JSON is already validated. An iterative lexer avoids PCRE stack limits
        // on long SRD descriptions while retaining escaped duplicate-key detection.
        $stack = [];
        $previous = null;
        $offset = 0;
        $length = strlen($text);
        while ($offset < $length) {
            $token = $text[$offset++];
            if ($token === '"') {
                $start = $offset - 1;
                while ($offset < $length) {
                    $offset += strcspn($text, '"\\', $offset);
                    if ($offset >= $length) {
                        throw new InvalidArgumentException('Unterminated JSON string.');
                    }
                    if ($text[$offset] === '\\') {
                        $offset += 2;
                    } else {
                        $offset++;
                        break;
                    }
                }
                if (in_array($previous, ['{', ','], true) && $stack && $stack[array_key_last($stack)] !== null) {
                    $key = json_decode(substr($text, $start, $offset - $start), true, 128, JSON_THROW_ON_ERROR);
                    $last = array_key_last($stack);
                    if (isset($stack[$last][$key])) {
                        throw new InvalidArgumentException('Duplicate JSON object key.');
                    }
                    $stack[$last][$key] = true;
                }
                $previous = '"';

                continue;
            }
            if ($token === '{' || $token === '[') {
                $stack[] = $token === '{' ? [] : null;
            } elseif ($token === '}' || $token === ']') {
                array_pop($stack);
            } elseif ($token !== ':' && $token !== ',') {
                continue;
            }
            $previous = $token;
        }
    }
}
