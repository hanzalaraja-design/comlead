import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { HighfyLogo } from "@/components/brand";
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
      <Card className="card-outlined w-full max-w-sm border-2 border-brand-primary shadow-none">
        <CardHeader className="items-center text-center">
          <HighfyLogo className="mb-2 w-36" />
          <CardTitle className="text-2xl font-bold text-brand-primary">Tasks</CardTitle>
          <CardDescription className="text-[15px] text-brand-primary-deep">
            Sign in with your Highfy Microsoft account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={signInWithMicrosoft}>
            <input type="hidden" name="next" value={safeNext(next)} />
            <Button type="submit" className="h-11 w-full gap-3">
              <MicrosoftLogo />
              Sign in with Microsoft
            </Button>
          </form>
          <p className="mt-4 text-center text-[13px] text-brand-primary-deep/70">
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
