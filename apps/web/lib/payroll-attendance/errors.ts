import { ApiError } from '@/lib/api/client';

/** Turns API failures into plain-language messages for HR users. Aborted (stale) requests return null. */
export function describeApiError(error: unknown, fallback: string): string | null {
  if (error instanceof DOMException && error.name === 'AbortError') return null;
  if (error instanceof ApiError) {
    switch (error.status) {
      case 401:
        return 'Your session has expired. Please sign out and sign in again.';
      case 403:
        return 'You do not have permission for this action. The server refused the request.';
      case 404:
        return 'The requested record was not found.';
      case 409:
        return `This action conflicts with the current state: ${error.message}`;
      default:
        return error.status >= 500 ? `${fallback} The server reported an error — please try again shortly.` : error.message;
    }
  }
  if (error instanceof TypeError) return `${fallback} The server could not be reached — check your connection.`;
  return fallback;
}
