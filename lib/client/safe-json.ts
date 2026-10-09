"use client";

export class ApiResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly statusText: string,
    readonly responseExcerpt: string,
  ) {
    super(message);
    this.name = "ApiResponseError";
  }
}

/** Read a fetch body exactly once and turn empty/invalid JSON into a useful error. */
export async function readJsonResponse<T>(response: Response, service: string): Promise<T> {
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
    throw new ApiResponseError(
      `${service} response could not be read. HTTP status: ${status}. ${error instanceof Error ? error.message : "Stream read failed."}`,
      response.status,
      response.statusText,
      "",
    );
  }

  const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
  if (!text.trim()) {
    throw new ApiResponseError(
      `${service} returned an empty response. HTTP status: ${status}.`,
      response.status,
      response.statusText,
      "",
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    const excerpt = text.replace(/\s+/g, " ").trim().slice(0, 420);
    throw new ApiResponseError(
      `${service} returned an invalid response. HTTP status: ${status}. Response: ${excerpt}`,
      response.status,
      response.statusText,
      excerpt,
    );
  }
}

export function isApiResponseError(error: unknown): error is ApiResponseError {
  return error instanceof ApiResponseError;
}
