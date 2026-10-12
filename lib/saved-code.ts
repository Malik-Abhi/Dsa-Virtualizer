import type { Language } from "@/types/execution";

export const SAVED_CODE_KEY = "dsa-saved-code-v1";
export type SavedCode = {
  id: string;
  name: string;
  source: string;
  language: Language;
  updatedAt: string;
};

/** Validate stored data before using it in the editor or overwriting the library. */
export function parseSavedCode(raw: string | null): SavedCode[] {
  if (raw === null) return [];
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error("Invalid saved code library");
  const ids = new Set<string>();
  return data.map((item: unknown) => {
    if (typeof item !== "object" || item === null)
      throw new Error("Invalid saved code");
    const entry = item as Record<string, unknown>;
    if (
      typeof entry.id !== "string" ||
      !entry.id ||
      ids.has(entry.id) ||
      typeof entry.name !== "string" ||
      !entry.name.trim() ||
      typeof entry.source !== "string" ||
      (entry.language !== "javascript" && entry.language !== "python") ||
      typeof entry.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(entry.updatedAt))
    )
      throw new Error("Invalid saved code");
    ids.add(entry.id);
    return {
      id: entry.id,
      name: entry.name,
      source: entry.source,
      language: entry.language,
      updatedAt: entry.updatedAt,
    };
  });
}
