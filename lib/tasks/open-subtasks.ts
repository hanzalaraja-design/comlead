/** Error marker: "the main task has open subtasks; ask before closing it". Shared by server and client. */
export const OPEN_SUBTASKS = "OPEN_SUBTASKS:";

export const openSubtaskCount = (error: string): number | null =>
  error.startsWith(OPEN_SUBTASKS) ? Number(error.slice(OPEN_SUBTASKS.length)) || 0 : null;
