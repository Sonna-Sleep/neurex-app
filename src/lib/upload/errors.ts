// Typed errors for the upload + processing pipeline. Lets callers branch on
// the failure mode (no auth, network timeout, server rejected, etc.) instead
// of parsing strings.

export class UploadError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'UploadError';
  }
}

export class NotAuthenticatedError extends UploadError {
  constructor() {
    super('No active Supabase session — sign in before uploading');
    this.name = 'NotAuthenticatedError';
  }
}

export class NetworkError extends UploadError {
  constructor(cause?: unknown) {
    super('Network request failed — check your connection', cause);
    this.name = 'NetworkError';
  }
}

export class ServerError extends UploadError {
  constructor(public readonly status: number, public readonly detail: string) {
    super(`Server returned ${status}: ${detail}`);
    this.name = 'ServerError';
  }
}

export class ProcessingTimeoutError extends UploadError {
  constructor(public readonly sessionId: string) {
    super(`Session ${sessionId} did not appear within the timeout window`);
    this.name = 'ProcessingTimeoutError';
  }
}
