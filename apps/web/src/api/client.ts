const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

let token = localStorage.getItem('cvht_token') || '';

export function setToken(nextToken: string): void {
  token = nextToken;
  localStorage.setItem('cvht_token', nextToken);
}

export function clearToken(): void {
  token = '';
  localStorage.removeItem('cvht_token');
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    let parsedMessage = '';
    try {
      const parsed = JSON.parse(text);
      parsedMessage = parsed?.message ?? parsed?.detail ?? '';
    } catch {
      parsedMessage = '';
    }
    if (res.status === 401) {
      clearToken();
      if (window.location.pathname !== '/') {
        window.location.assign('/');
      }
      throw new Error(parsedMessage || 'Phiên đăng nhập hết hạn hoặc không hợp lệ');
    }
    throw new Error(parsedMessage || text || `API error ${res.status}`);
  }

  return (await res.json()) as T;
}
