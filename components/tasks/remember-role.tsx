"use client";

import { useEffect } from "react";

/** My tasks opens on whichever of I own / Collaborating / All you looked at last. */
export function RememberRole({ role }: { role: string }) {
  useEffect(() => {
    document.cookie = `my_role=${role}; path=/; max-age=31536000; samesite=lax`;
  }, [role]);
  return null;
}
