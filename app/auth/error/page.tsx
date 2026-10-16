import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const MESSAGES: Record<string, { title: string; body: string }> = {
  domain: {
    title: "Highfy accounts only",
    body: "This app is only for @highfy.pk Microsoft accounts. You have been signed out. Sign in again with your Highfy work account.",
  },
  provider: {
    title: "Sign-in didn't complete",
    body: "Microsoft sign-in was cancelled or failed. Please try again.",
  },
};

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const msg = MESSAGES[reason ?? ""] ?? MESSAGES.provider;

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{msg.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{msg.body}</p>
          <Button asChild className="w-full">
            <Link href="/login">Back to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
