export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/** Turn Postgres / PostgREST errors into something a person can act on. */
export function friendlyError(error: { message?: string; code?: string } | null | undefined): string {
  if (!error) return "Something went wrong.";
  if (error.code === "42501" || /row-level security|permission/i.test(error.message ?? "")) {
    // Our own guard triggers raise readable 42501 messages; RLS ones don't.
    return /row-level security/i.test(error.message ?? "") || !error.message
      ? "You don't have permission to do that."
      : error.message;
  }
  if (error.code === "23505") return "That already exists.";
  if (error.code === "23514") return "Some values aren't valid.";
  return error.message ?? "Something went wrong.";
}
