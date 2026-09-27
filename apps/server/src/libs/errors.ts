/** An error that maps directly to an HTTP response. Throw it from route handlers. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);
export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const conflict = (message: string) => new HttpError(409, message);
