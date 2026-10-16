import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { HighfyLogo } from "@/components/brand";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getViewer } from "@/lib/auth";

export const metadata = { title: "Waiting for approval · Highfy Tasks" };

export default async function PendingPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (viewer.profile.status === "active") redirect("/");

  const disabled = viewer.profile.status === "disabled";

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="card-outlined w-full max-w-sm border-2 border-brand-primary shadow-none">
        <div className="flex justify-center pt-6">
          <HighfyLogo className="w-28" />
        </div>
        <CardHeader>
          <CardTitle className="text-xl font-bold text-brand-primary">{disabled ? "Account disabled" : "Waiting for approval"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            Signed in as <span className="font-medium text-foreground">{viewer.email}</span>.
          </p>
          <p>
            {disabled
              ? "Your access has been turned off. Contact an Admin if this is a mistake."
              : "An Admin needs to add you to a department before you can use Highfy Tasks. Check back once they've done that."}
          </p>
          <form action="/auth/signout" method="post">
            <Button variant="outline" className="w-full" type="submit">
              Sign out
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
