import { Request } from "express";

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

// ---------------------------------------------------------------------------
// Cursor encoding / decoding
// Cursor format (before base64): "<id>:<timestamp>"
// Both fields are always strings; id falls back to array index when no
// natural PK exists.
// ---------------------------------------------------------------------------

/**
 * Encode a primary-key + timestamp pair into an opaque base64 cursor string.
 */
export function buildCursor(id: string, timestamp: string): string {
  return Buffer.from(`${id}:${timestamp}`).toString("base64");
}

/**
 * Decode an opaque cursor string back to { id, timestamp }.
 * Returns null if the cursor is malformed.
 */
export function parseCursor(cursor: string): { id: string; timestamp: string } | null {
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf8");
    const colonIdx = decoded.indexOf(":");
    if (colonIdx < 0) return null;
    return {
      id: decoded.slice(0, colonIdx),
      timestamp: decoded.slice(colonIdx + 1),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Query-param parsing
// ---------------------------------------------------------------------------

export interface PaginationParams {
  limit: number;
  cursor: string | undefined;
}

/**
 * Parse `cursor` and `limit` query parameters from an Express request.
 */
export function parsePagination(req: Request): PaginationParams {
  const rawLimit = parseInt(String(req.query.limit ?? DEFAULT_LIMIT), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_LIMIT)
    : DEFAULT_LIMIT;

  const cursor =
    typeof req.query.cursor === "string" && req.query.cursor.length > 0
      ? req.query.cursor
      : undefined;

  return { limit, cursor };
}

// ---------------------------------------------------------------------------
// Generic array paginator
// ---------------------------------------------------------------------------

export interface PaginatedResult<T> {
  data: T[];
  nextCursor: string | null;
}

/**
 * Apply cursor-based pagination to an in-memory array.
 *
 * @param items       Full array of items (already in desired order).
 * @param getFields   Extract { id, timestamp } from an item. Falls back to
 *                    array-index + epoch-0 when omitted.
 * @param limit       Page size (already clamped to MAX_LIMIT by parsePagination).
 * @param cursor      Opaque cursor from the previous page (undefined = first page).
 */
export function paginateArray<T>(
  items: T[],
  getFields: ((item: T, index: number) => { id: string; timestamp: string }) | undefined,
  limit: number,
  cursor?: string,
): PaginatedResult<T> {
  const resolveFields = getFields ?? ((_item: T, index: number) => ({
    id: String(index),
    timestamp: "0",
  }));

  let startIndex = 0;

  if (cursor) {
    const decoded = parseCursor(cursor);
    if (decoded) {
      // Find the item that matches the cursor; start from the item after it
      const matchIdx = items.findIndex((item, i) => {
        const fields = resolveFields(item, i);
        return fields.id === decoded.id && fields.timestamp === decoded.timestamp;
      });
      if (matchIdx >= 0) {
        startIndex = matchIdx + 1;
      }
    }
  }

  const pageItems = items.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < items.length;

  let nextCursor: string | null = null;
  if (hasMore && pageItems.length > 0) {
    const lastItem = pageItems[pageItems.length - 1];
    const lastIndex = startIndex + pageItems.length - 1;
    const fields = resolveFields(lastItem, lastIndex);
    nextCursor = buildCursor(fields.id, fields.timestamp);
  }

  return { data: pageItems, nextCursor };
}
