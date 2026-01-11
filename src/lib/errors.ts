export function normalizeError(error: unknown): string {
  if (!error) return "Unknown error.";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return JSON.stringify(error);
}
