import Image from "next/image";
import { cn } from "@/lib/utils";

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
