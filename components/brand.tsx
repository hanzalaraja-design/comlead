import Image from "next/image";
import { cn } from "@/lib/utils";

/** The orange Highfy crown, top-right of every page header. */
export function CrownMark({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/crown.png"
      alt=""
      aria-hidden
      width={28}
      height={25}
      className={cn("h-auto w-6 shrink-0 md:w-7", className)}
      priority
    />
  );
}

/** The Highfy wordmark logo. */
export function HighfyLogo({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/highfy-logo.png"
      alt="Highfy"
      width={1146}
      height={585}
      className={cn("h-auto w-24", className)}
      priority
    />
  );
}
