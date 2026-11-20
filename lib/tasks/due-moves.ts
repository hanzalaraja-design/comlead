/** A due date change that pushed an existing deadline later (what "+2" counts). */
export const isPushedLater = (from: string | null | undefined, to: string | null | undefined) => !!from && !!to && to > from;
