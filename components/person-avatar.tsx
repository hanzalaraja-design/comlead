import { cn } from "@/lib/utils";
import { initials, personName } from "@/lib/labels";
import type { PersonRef } from "@/lib/types";

export function PersonAvatar({ person, className }: { person: PersonRef | null | undefined; className?: string }) {
  return (
    <span
      title={personName(person)}
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground",
        className,
      )}
    >
      {person ? initials(person) : "–"}
    </span>
  );
}
