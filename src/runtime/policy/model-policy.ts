export const DEFAULT_MODEL = "rovodev-auto";

export function normalizeRequestedModel(model: unknown): string {
  return typeof model === "string" && model ? model : DEFAULT_MODEL;
}
