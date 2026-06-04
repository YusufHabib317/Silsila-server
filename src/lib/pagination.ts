import { AppError } from "./app-error.ts";

export type DateIdCursor = {
  createdAt: Date;
  id: string;
};

type EncodedDateIdCursor = {
  createdAt: string;
  id: string;
};

function isCursorShape(value: unknown): value is EncodedDateIdCursor {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.createdAt === "string" && typeof candidate.id === "string";
}

export function encodeDateIdCursor(cursor: DateIdCursor): string {
  const payload: EncodedDateIdCursor = {
    createdAt: cursor.createdAt.toISOString(),
    id: cursor.id,
  };

  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeDateIdCursor(cursor: string): DateIdCursor {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );

    if (!isCursorShape(parsed)) {
      throw new Error("Cursor payload has an invalid shape.");
    }

    const createdAt = new Date(parsed.createdAt);

    if (Number.isNaN(createdAt.getTime())) {
      throw new Error("Cursor date is invalid.");
    }

    return {
      createdAt,
      id: parsed.id,
    };
  } catch {
    throw new AppError({
      code: "INVALID_CURSOR",
      message: "Pagination cursor is invalid.",
      statusCode: 400,
    });
  }
}
