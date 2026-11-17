// The one way the screens talk to the API.

import type { ApiError } from "@2mg/api/types";
import { toastFor } from "./toast";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly field?: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  options: { method?: "GET" | "POST" | "PATCH"; body?: unknown } = {},
): Promise<T> {
  let response: Response;
  const form = options.body instanceof FormData;
  const method = options.method ?? (options.body === undefined ? "GET" : "POST");
  try {
    response = await fetch(path, {
      method,
      credentials: "include",
      // A FormData body (a file upload) sets its own content type.
      headers:
        options.body === undefined || form ? undefined : { "content-type": "application/json" },
      body:
        options.body === undefined
          ? undefined
          : form
            ? (options.body as FormData)
            : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiFailure(
      0,
      "offline",
      "Can't reach the server. Check your connection and try again.",
    );
  }
  const data = (await response.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!response.ok || !data) {
    const error = data?.error;
    throw new ApiFailure(
      response.status,
      error?.code ?? "failed",
      error?.message ?? `The server answered ${response.status}.`,
      error?.field,
      error?.fields,
    );
  }
  toastFor(method, path);
  return data;
}
