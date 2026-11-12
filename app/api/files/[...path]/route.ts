import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Screenshots pasted into descriptions and comments. The page links to
 * /api/files/inline-files/<path>; this checks you're signed in (the bucket's
 * rules check you're an active Highfy user) and sends you to a short-lived link.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const [bucket, ...rest] = path;
  const name = rest.map(decodeURIComponent).join("/");
  if (bucket !== "inline-files" || !name || name.includes("..")) return new NextResponse("Not found", { status: 404 });

  const supabase = await createClient();
  const { data } = await supabase.storage.from(bucket).createSignedUrls([name], 3600);
  const url = data?.[0]?.signedUrl;
  if (!url) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, max-age=1800" } });
}
