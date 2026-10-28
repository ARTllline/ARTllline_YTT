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
export const getCsrf = () => csrf;
let socketId: () => string | undefined = () => undefined;
export const bindSocket = (get: () => string | undefined) => {
    socketId = get;
};
// Retain ambiguous one-off dialog/button commands too, not only SaveQueue jobs.
// The next identical retry uses the original ID; a confirmed command is removed.
const ambiguous = new Map<string, string>();
export async function request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
    signal?: AbortSignal,
): Promise<T> {
    const form = body instanceof FormData;
    let commandKey: string | undefined;
    let mutationId: string | undefined;
    if (body && !form && typeof body === 'object' && 'clientMutationId' in body) {
        const { clientMutationId, ...payload } = body as Record<string, unknown>;
        commandKey = JSON.stringify([method, path, payload]);
        mutationId = ambiguous.get(commandKey) ?? String(clientMutationId);
        body = { ...payload, clientMutationId: mutationId };
    }
    const retain = () => {
        if (commandKey && mutationId) {
            ambiguous.set(commandKey, mutationId);
            if (ambiguous.size > 100) ambiguous.delete(ambiguous.keys().next().value!);
        }
    };
    let response: Response;
    try {
        response = await fetch(`/api${path}`, {
            method,
            credentials: 'same-origin',
            signal,
            headers: {
                Accept: 'application/json',
                'X-CSRF-TOKEN': csrf,
                ...(socketId() ? { 'X-Socket-ID': socketId()! } : {}),
                ...(body && !form ? { 'Content-Type': 'application/json' } : {}),
            },
            body: body === undefined ? undefined : form ? (body as FormData) : JSON.stringify(body),
        });
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        retain();
        throw new ApiError(
            'Connection lost. Your changes have not been confirmed. Check the connection and retry.',
            0,
        );
    }
    const data = await response.json().catch(() => ({}));
    if (response.status >= 500) retain();
    else if (commandKey) ambiguous.delete(commandKey);
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
