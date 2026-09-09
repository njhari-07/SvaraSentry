const configuredApiBase = process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "");
const configuredPublicOrigin = process.env.NEXT_PUBLIC_PUBLIC_ORIGIN?.replace(/\/$/, "");

function apiBase(): string {
  if (configuredApiBase) return configuredApiBase;
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:8000`;
  }
  return "http://localhost:8000";
}

export function apiUrl(path: string): string {
  return `${apiBase()}${path}`;
}

export function websocketUrl(path: string): string {
  return `${apiBase().replace(/^http/, "ws")}${path}`;
}

export function publicUrl(path: string): string {
  if (configuredPublicOrigin) return `${configuredPublicOrigin}${path}`;
  if (typeof window !== "undefined") return new URL(path, window.location.origin).toString();
  return path;
}

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), init);
  const body: unknown = await response.json();
  if (!response.ok) {
    const detail = typeof body === "object" && body && "detail" in body ? body.detail : null;
    throw new Error(typeof detail === "string" ? detail : "Request failed");
  }
  return body as T;
}
