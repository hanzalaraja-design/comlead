import { NextResponse, type NextRequest } from "next/server";
import { userForKey, type KeyUser } from "@/lib/mcp/keys";
import { TOOLS, callTool } from "@/lib/mcp/tools";

/**
 * The Claude connector: a small MCP server (JSON-RPC over HTTP POST).
 * Each person adds their own link from My settings, and Claude then acts as
 * them. It can read, create and update; it can't delete anything.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const result = (id: RpcRequest["id"], value: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result: value });
const failure = (id: RpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

const NO_KEY =
  "This Highfy Tasks link isn't valid any more. Make a new one in Highfy Tasks → My settings → Connect to Claude, and add it to Claude again.";

function keyFrom(request: NextRequest): string | null {
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return request.nextUrl.searchParams.get("key");
}

async function handle(msg: RpcRequest, getUser: () => Promise<KeyUser | null>) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;
  if (!method) return failure(id, -32600, "Invalid request.");

  switch (method) {
    case "initialize": {
      const asked = typeof params?.protocolVersion === "string" ? params.protocolVersion : "";
      return result(id, {
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "Highfy Tasks", version: "1.0.0" },
        instructions:
          "Highfy Tasks is the team's task tracker. You act as the person who connected it, with their permissions. " +
          "You can read, create and update tasks, add comments, and look up projects, campaigns, partnerships, meetings, people and teams. " +
          "You can't delete anything. Dates are in Pakistan time (PKT). Link to tasks with the URLs the tools give you.",
      });
    }
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, {
        tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })),
      });
    case "tools/call": {
      const user = await getUser();
      if (!user) return result(id, { content: [{ type: "text", text: NO_KEY }], isError: true });
      const name = typeof params?.name === "string" ? params.name : "";
      const args = (params?.arguments && typeof params.arguments === "object" ? params.arguments : {}) as Record<string, unknown>;
      const out = await callTool(user, name, args);
      return result(id, { content: [{ type: "text", text: out.text }], isError: out.isError });
    }
    default:
      if (isNotification || method.startsWith("notifications/")) return null;
      return failure(id, -32601, `Method not found: ${method}`);
  }
}

export async function POST(request: NextRequest) {
  const key = keyFrom(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(failure(null, -32700, "Parse error."), { status: 400 });
  }

  // Check the key up front (so a bad link fails clearly when Claude connects), then reuse it.
  let user: Promise<KeyUser | null> | null = null;
  const getUser = () => (user ??= userForKey(key).catch((e) => {
    console.error("[mcp] key", e);
    return null;
  }));
  if (!(await getUser())) {
    const first = Array.isArray(body) ? (body[0] as RpcRequest) : (body as RpcRequest);
    return NextResponse.json(failure(first?.id, -32001, NO_KEY));
  }

  const messages = (Array.isArray(body) ? body : [body]) as RpcRequest[];
  const replies = (await Promise.all(messages.map((m) => handle(m ?? {}, getUser)))).filter((r) => r !== null);
  if (replies.length === 0) return new NextResponse(null, { status: 202 });
  return NextResponse.json(Array.isArray(body) ? replies : replies[0]);
}

const notAllowed = () => new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
export const GET = notAllowed;
export const DELETE = notAllowed;
