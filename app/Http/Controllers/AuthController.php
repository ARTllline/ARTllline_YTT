<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function session(Request $request): array
    {
        $user = $request->user();

        return ['user' => $user ? ['id' => (string) $user->id, 'name' => $user->name, 'email' => $user->email] : null, 'csrf' => csrf_token(),
            'realtime' => ['key' => config('broadcasting.connections.reverb.key'), 'host' => config('broadcasting.connections.reverb.options.host'),
                'port' => config('broadcasting.connections.reverb.options.port'), 'scheme' => config('broadcasting.connections.reverb.options.scheme')]];
    }

    public function register(Request $request): array
    {
        $request->merge(['email' => mb_strtolower(trim((string) $request->input('email')))]);
        $data = $request->validate(['name' => 'required|string|max:80', 'email' => 'required|email|max:255|unique:users',
            'password' => ['required', 'string', 'confirmed', 'max:128', Password::min(10)]]);
        $user = User::create($data);
        Auth::login($user);
        $request->session()->regenerate();

        return $this->session($request);
    }

    public function login(Request $request): array
    {
        $data = $request->validate(['email' => 'required|string|email|max:255', 'password' => 'required|string|max:128']);
        $data['email'] = mb_strtolower(trim($data['email']));
        if (! Auth::attempt($data)) {
            throw ValidationException::withMessages(['email' => 'The email or password is incorrect.']);
        }
        $request->session()->regenerate();

        return $this->session($request);
    }

    public function logout(Request $request): array
    {
        Auth::logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return ['user' => null, 'csrf' => csrf_token()];
    }
}
