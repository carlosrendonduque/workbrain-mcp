import type { ClientScope } from "./tenancy";

/**
 * How an API key's scope reaches a route handler.
 *
 * The middleware validates the key, looks up the client it is pinned to, and
 * sets this header on the onward request. It deletes any inbound copy first,
 * so a caller cannot widen — or forge — their own scope by sending it.
 */
export const CLIENT_SCOPE_HEADER = "x-client-scope";

export interface Caller {
  userId: string;
  /** The one client this key may touch, or null for all of the user's. */
  clientScope: ClientScope;
}

/**
 * Read the caller out of the headers the middleware set.
 *
 * Returns null when there is no user, which a route turns into a 401. There
 * is deliberately no "assume unscoped" fallback: an unrecognised request gets
 * no access rather than full access.
 */
export function callerFromHeaders(headers: Headers): Caller | null {
  const userId = headers.get("x-user-id");
  if (!userId) return null;
  return { userId, clientScope: headers.get(CLIENT_SCOPE_HEADER) };
}
