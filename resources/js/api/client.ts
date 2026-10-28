export class ApiError extends Error {
    constructor(
        message: string,
        public status: number,
        public fields: Record<string, string[]> = {},
    ) {
        super(message);
    }
}
let csrf =
    typeof document === 'undefined'
        ? ''
        : (document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '');
export function setCsrf(value: string) {
    csrf = value;
}
export async function request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
    signal?: AbortSignal,
): Promise<T> {
    const form = body instanceof FormData;
    let response: Response;
    try {
        response = await fetch(`/api${path}`, {
            method,
            credentials: 'same-origin',
            signal,
            headers: {
                Accept: 'application/json',
                'X-CSRF-TOKEN': csrf,
                ...(body && !form ? { 'Content-Type': 'application/json' } : {}),
            },
            body: body === undefined ? undefined : form ? body : JSON.stringify(body),
        });
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        throw new ApiError(
            'Connection lost. Your changes have not been confirmed. Check the connection and retry.',
            0,
        );
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const fields = data.errors as Record<string, string[]> | undefined;
        const message =
            response.status === 419
                ? 'Your session expired. Reload and sign in again.'
                : response.status === 401
                  ? 'Please sign in again.'
                  : response.status === 403
                    ? 'You do not have permission to do that.'
                    : response.status === 413
                      ? 'This image is too large for the server upload limit.'
                      : response.status >= 500
                        ? 'The server could not save this change. Please retry.'
                        : fields
                          ? Object.values(fields).flat().join(' ')
                          : (data.message ?? 'The request could not be completed.');
        throw new ApiError(message, response.status, fields);
    }
    return data as T;
}
