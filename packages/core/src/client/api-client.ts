import type { ApiEnvelope, CommandContext } from "../types.js";

interface ApiRequestOptions {
  timeoutMs?: number;
}

export interface ApiUploadFile {
  filename: string;
  body: Buffer | Uint8Array;
  contentType?: string | undefined;
}

export interface ApiDownloadResult {
  body: Buffer;
  contentType: string;
  filename: string | undefined;
  headers: Headers;
}

export interface ApiErrorDetails {
  url?: string;
  contentType?: string;
  bodyPreview?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
    readonly details?: ApiErrorDetails
  ) {
    super(message);
  }
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly context: CommandContext
  ) {}

  async get<T>(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
    options?: ApiRequestOptions
  ): Promise<T> {
    return this.request<T>("GET", path, undefined, query, options);
  }

  async post<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>("POST", path, body, undefined, options);
  }

  async put<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>("PUT", path, body, undefined, options);
  }

  async patch<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>("PATCH", path, body, undefined, options);
  }

  async delete<T>(path: string, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>("DELETE", path, undefined, undefined, options);
  }

  async upload<T>(
    path: string,
    file: ApiUploadFile,
    fields?: Record<string, string | number | boolean | undefined>,
    options?: ApiRequestOptions
  ): Promise<T> {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields ?? {})) {
      if (value !== undefined) {
        form.set(key, String(value));
      }
    }
    const bytes = file.body instanceof Buffer ? file.body : Buffer.from(file.body);
    form.set("file", new Blob([bytes], { type: file.contentType ?? "application/octet-stream" }), file.filename);
    try {
      const response = await this.fetchRaw("POST", path, form, undefined, options);
      const payload = await this.readJsonEnvelope<T>(response);
      if (!response.ok || payload.error) {
        throw new ApiError(
          payload.error?.message || response.statusText,
          payload.error?.code || "request_failed",
          response.status
        );
      }
      return payload.data as T;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ApiError("Request timed out.", "request_timeout", 408);
      }
      throw new ApiError(
        error instanceof Error ? error.message : "Network request failed.",
        "network_error",
        0
      );
    }
  }

  async download(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean | undefined>,
    options?: ApiRequestOptions
  ): Promise<ApiDownloadResult> {
    try {
      const response = await this.fetchRaw(method, path, body, query, options);
      if (!response.ok) {
        throw await this.apiErrorFromResponse(response);
      }
      const arrayBuffer = await response.arrayBuffer();
      return {
        body: Buffer.from(arrayBuffer),
        contentType: response.headers.get("content-type") ?? "application/octet-stream",
        filename: filenameFromContentDisposition(response.headers.get("content-disposition")),
        headers: response.headers
      };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ApiError("Request timed out.", "request_timeout", 408);
      }
      throw new ApiError(
        error instanceof Error ? error.message : "Network request failed.",
        "network_error",
        0
      );
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean | undefined>,
    options?: ApiRequestOptions
  ): Promise<T> {
    try {
      const response = await this.fetchRaw(method, path, body, query, options);
      const payload = await this.readJsonEnvelope<T>(response);
      if (!response.ok || payload.error) {
        throw new ApiError(
          payload.error?.message || response.statusText,
          payload.error?.code || "request_failed",
          response.status
        );
      }
      return payload.data as T;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ApiError("Request timed out.", "request_timeout", 408);
      }
      throw new ApiError(
        error instanceof Error ? error.message : "Network request failed.",
        "network_error",
        0
      );
    }
  }

  private async fetchRaw(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean | undefined>,
    options?: ApiRequestOptions
  ): Promise<Response> {
    const url = new URL(path.replace(/^\//, ""), this.ensureTrailingSlash(this.baseUrl));
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    if (this.context.verbose) {
      console.error(`[http] ${method} ${url.toString()}`);
    }
    const init: RequestInit = {
      method,
      headers: {
        // sign-up and sign-in by email code are the only calls without a key
        ...(this.apiKey ? { "API-Key": this.apiKey } : {}),
        ...(this.context.requestId ? { "X-Request-ID": this.context.requestId } : {}),
        ...(this.context.integrationSource ? { "HT-Integration-Source": this.context.integrationSource } : {}),
        ...(this.context.clientUserAgent ? { "User-Agent": this.context.clientUserAgent } : {})
      }
    };
    const timeoutMs = options?.timeoutMs;
    const controller = timeoutMs ? new AbortController() : undefined;
    let timeout: NodeJS.Timeout | undefined;
    if (controller) {
      init.signal = controller.signal;
      timeout = setTimeout(() => controller.abort(), timeoutMs).unref();
    }
    if (body !== undefined) {
      if (body instanceof FormData) {
        init.body = body;
      } else {
        (init.headers as Record<string, string>)["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
      }
    }
    try {
      return await this.fetchWithRetry(url, init, method);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private async apiErrorFromResponse(response: Response): Promise<ApiError> {
    try {
      const payload = await this.readJsonEnvelope<unknown>(response);
      return new ApiError(
        payload.error?.message || response.statusText,
        payload.error?.code || "request_failed",
        response.status
      );
    } catch (error) {
      if (error instanceof ApiError) {
        return error;
      }
      return new ApiError(response.statusText || "Request failed.", "request_failed", response.status);
    }
  }

  private async readJsonEnvelope<T>(response: Response): Promise<ApiEnvelope<T>> {
    const text = await response.text();
    try {
      return JSON.parse(text) as ApiEnvelope<T>;
    } catch {
      const contentType = response.headers.get("content-type") ?? "unknown content-type";
      const bodyPreview = previewResponseBody(text);
      const statusText = response.statusText ? ` ${response.statusText}` : "";
      throw new ApiError(
        `Expected JSON response from ${response.url || "API"}; received ${contentType} with HTTP ${response.status}${statusText}. Body preview: ${bodyPreview}`,
        "request_failed",
        response.status,
        {
          url: response.url,
          contentType,
          bodyPreview
        }
      );
    }
  }

  private ensureTrailingSlash(url: string): string {
    return url.endsWith("/") ? url : `${url}/`;
  }

  private async fetchWithRetry(url: URL, init: RequestInit, method: string): Promise<Response> {
    const retryableMethod = method === "GET";
    const attempts = retryableMethod ? 3 : 1;
    let lastResponse: Response | undefined;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetch(url, init);
        const retryAfter = response.headers.get("retry-after");
        const retryableStatus = [408, 500, 502, 503, 504].includes(response.status) || (response.status === 429 && Boolean(retryAfter));
        if (!retryableMethod || !retryableStatus || attempt === attempts) {
          return response;
        }
        lastResponse = response;
      } catch (error) {
        lastError = error;
        if (!retryableMethod || attempt === attempts) {
          throw error;
        }
      }
      const retryAfter = lastResponse?.headers.get("retry-after");
      const retryAfterMs = retryAfter ? Number.parseFloat(retryAfter) * 1000 : undefined;
      const delayMs = Number.isFinite(retryAfterMs) ? Math.min(retryAfterMs as number, 5000) : 150 * attempt;
      if (this.context.verbose) {
        console.error(`[http] retry ${attempt}/${attempts} ${method} ${url.toString()} in ${delayMs}ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (lastError) {
      throw lastError;
    }
    return lastResponse as Response;
  }
}

function previewResponseBody(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "<empty>";
  }
  return normalized.length > 240 ? `${normalized.slice(0, 240)}...` : normalized;
}

function filenameFromContentDisposition(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(value);
  if (utf8Match) {
    return decodeURIComponent(utf8Match[1] ?? "");
  }
  const quotedMatch = /filename="([^"]+)"/i.exec(value);
  if (quotedMatch) {
    return quotedMatch[1];
  }
  const plainMatch = /filename=([^;]+)/i.exec(value);
  return plainMatch?.[1]?.trim();
}
