// Thin fetch wrapper — mirrors the vanilla app's own assets/ui.js api()
// helper closely enough to be recognizable: throws ApiError with the
// server's own message on a non-2xx response, sends/receives JSON,
// always includes the session cookie.

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Accept: 'application/json',
      ...options.headers,
    },
  })

  // A 204 (e.g. logout) has no body to parse.
  const text = await res.text()
  const data = text ? JSON.parse(text) : null

  if (!res.ok) {
    const message = (data && typeof data === 'object' && 'error' in data ? String(data.error) : null) || `Request failed (${res.status}).`
    throw new ApiError(res.status, message)
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  // The channel background upload is a raw file body with its own
  // Content-Type, not JSON — mirrors Rails' express.raw({type:'image/*'})
  // equivalent (Internal/Api::ChannelsController#background): no
  // multipart parsing, no new dependency.
  putRaw: <T>(path: string, file: File) => request<T>(path, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } }),
}
