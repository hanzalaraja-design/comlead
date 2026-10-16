import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getViewer } from "@/lib/auth";
import { safeNext } from "@/lib/safe-next";
import { signInWithMicrosoft } from "./actions";

export const metadata = { title: "Sign in · Highfy Tasks" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  if (await getViewer()) redirect(safeNext(next));

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">
            H
          </div>
          <CardTitle className="text-2xl">Highfy Tasks</CardTitle>
          <CardDescription>Sign in with your Highfy Microsoft account.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={signInWithMicrosoft}>
            <input type="hidden" name="next" value={safeNext(next)} />
            <Button type="submit" className="h-11 w-full gap-3">
              <MicrosoftLogo />
              Sign in with Microsoft
            </Button>
          </form>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Only @highfy.pk accounts can access this app.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}
