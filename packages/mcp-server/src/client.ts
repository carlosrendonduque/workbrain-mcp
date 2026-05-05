import type { Config } from "./config.js";

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: { code: string; message: string; detail?: unknown };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export class WorkBrainApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: unknown;

  constructor(code: string, message: string, status: number, detail?: unknown) {
    super(message);
    this.name = "WorkBrainApiError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export class WorkBrainClient {
  private readonly config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.config.apiUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
    });
    return this.parse<T>(response);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.config.apiUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return this.parse<T>(response);
  }

  private async parse<T>(response: Response): Promise<T> {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new WorkBrainApiError(
        "non_json_response",
        `Backend returned a non-JSON response (HTTP ${response.status})`,
        response.status,
      );
    }

    if (!isApiResponse(payload)) {
      throw new WorkBrainApiError(
        "malformed_response",
        "Backend response did not match the expected ApiResponse shape",
        response.status,
        payload,
      );
    }

    if (payload.ok) {
      return payload.data as T;
    }

    throw new WorkBrainApiError(
      payload.error.code,
      payload.error.message,
      response.status,
      payload.error.detail,
    );
  }
}

function isApiResponse(value: unknown): value is ApiSuccess<unknown> | ApiFailure {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (obj.ok === true && "data" in obj) return true;
  if (obj.ok === false && typeof obj.error === "object" && obj.error !== null) {
    const err = obj.error as Record<string, unknown>;
    return typeof err.code === "string" && typeof err.message === "string";
  }
  return false;
}
