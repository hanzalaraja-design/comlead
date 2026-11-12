"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, ImagePlus, Paperclip, Plus, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PersonAvatar } from "@/components/person-avatar";
import { createClient } from "@/lib/supabase/client";
import { personName } from "@/lib/labels";
import { DOMAINS } from "@/lib/domains";
import { formatDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import {
  CHANNEL_LABELS,
  CHANNEL_STYLES,
  STATUS_LABELS,
  STATUS_STYLES,
  byNeeded,
  designGroups,
  fileVersion,
  isOpen,
  type Channel,
  type CreativeRequest,
  type RequestComment,
} from "@/lib/creative";
import type { PersonRef, ProjectKind } from "@/lib/types";
import {
  addArtwork,
  approveRequest,
  askForChanges,
  cancelRequest,
  createRequest,
  markRequestLive,
  addRequestComment,
  deleteRequestComment,
  markRequestComplete,
  sendForReview,
  takeRequest,
  updateRequest,
  type RequestInput,
} from "@/app/(app)/placements/request-actions";
import { imagesIn } from "@/lib/inline-upload";
import { PlainText } from "@/components/plain-text";
import { CommentImages, PendingImages, usePastedImages } from "@/components/pasted-images";

const BUCKET = "placement-files";
const safeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-80);
const isImage = (path: string) => /\.(png|jpe?g|gif|webp|avif)$/i.test(path);

async function upload(id: string, folder: "refs" | `art/v${number}`, files: File[]): Promise<string[]> {
  const supabase = createClient();
  const paths: string[] = [];
  for (const file of files) {
    const path = `requests/${id}/${folder}/${Date.now()}-${safeName(file.name || "screenshot.png")}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
    if (error) throw new Error(`Couldn't upload ${file.name}: ${error.message}`);
    paths.push(path);
  }
  return paths;
}

export type LinkOption = { id: string; name: string; kind: ProjectKind };

type Shared = {
  people: PersonRef[];
  links: LinkOption[];
  urls: Record<string, string>;
  viewerId: string;
  /** In the Design team (or an Admin). */
  isDesign: boolean;
  /** Design's lead or an Admin: can give work to a designer. */
  canAssign: boolean;
  designers: PersonRef[];
  today: string;
  /** Comments on the requests shown, oldest first. */
  comments: RequestComment[];
};

function ChannelTag({ channel }: { channel: Channel | "web" }) {
  return (
    <span className={cn("shrink-0 rounded-md px-1.5 py-px text-[11.5px] font-bold", CHANNEL_STYLES[channel])}>
      {channel === "web" ? "App / Website" : CHANNEL_LABELS[channel]}
    </span>
  );
}

function StatusChip({ r }: { r: CreativeRequest }) {
  const sentBack = r.status === "in_design" && !!r.change_note;
  return (
    <span className={cn("inline-block rounded-lg px-2 py-0.5 text-xs font-bold", sentBack ? "bg-warning-soft text-warning-ink" : STATUS_STYLES[r.status])}>
      {sentBack ? "Revision asked" : STATUS_LABELS[r.status]}
    </span>
  );
}

function LinkTag({ link }: { link?: LinkOption }) {
  if (!link) return null;
  return (
    <span className="rounded-md bg-subtle px-1.5 py-px text-[11.5px] font-semibold text-ink">
      {DOMAINS[link.kind].label} · {link.name}
    </span>
  );
}

const day = (d: string | null) => (d ? formatDate(d, "EEE d MMM") : null);

/** One request's sheet, opened from any tab. */
function useOpenRequest(requests: CreativeRequest[], openId: string | null) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(() => (openId && requests.some((r) => r.id === openId) ? openId : null));
  useEffect(() => {
    if (!openId) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("open");
    router.replace(url.pathname + url.search, { scroll: false });
  }, [openId, router]);
  return [open, setOpen] as const;
}

// ---------------------------------------------------------------------------
// A channel's tab: its requests and a button to ask for something new
// ---------------------------------------------------------------------------

export function ChannelRequests({
  channel,
  requests,
  openId,
  ...shared
}: Shared & { channel: Channel; requests: CreativeRequest[]; openId: string | null }) {
  const [show, setShow] = useState<"open" | "live" | "all">("open");
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useOpenRequest(requests, openId);
  const people = new Map(shared.people.map((p) => [p.id, p]));
  const links = new Map(shared.links.map((l) => [l.id, l]));
  const list = requests
    .filter((r) => r.status !== "cancelled")
    .filter((r) => (show === "open" ? isOpen(r) : show === "live" ? r.status === "live" || r.status === "done" : true))
    .sort((a, b) => Number(!isOpen(a)) - Number(!isOpen(b)) || byNeeded(a, b));
  const current = requests.find((r) => r.id === open);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-[12px] bg-subtle p-0.5 text-sm">
          {(["open", "live", "all"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={show === k}
              onClick={() => setShow(k)}
              className={cn("rounded-[10px] px-3 py-1 font-semibold", show === k ? "bg-white text-ink shadow-sm" : "text-ink-muted hover:text-ink")}
            >
              {k === "open" ? "Open" : k === "live" ? "Done" : "All"}
            </button>
          ))}
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> New {CHANNEL_LABELS[channel]} request
        </Button>
      </div>

      {list.length ? (
        <ul className="divide-y divide-line overflow-hidden surface">
          {list.map((r) => {
            const late = isOpen(r) && r.status !== "approved" && !!r.needed_by && r.needed_by < shared.today;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setOpen(r.id)}
                  className={cn(
                    "relative grid w-full gap-2 px-4 py-3 text-left hover:bg-subtle/60 md:grid-cols-[8rem_minmax(0,1fr)_8rem_8rem_8rem] md:items-center md:gap-3",
                    late && "before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-danger",
                  )}
                >
                  <span>
                    <StatusChip r={r} />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink">{r.title}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                      <LinkTag link={r.project_id ? links.get(r.project_id) : undefined} />
                      {r.formats && <span>{r.formats}</span>}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 text-sm">
                    <PersonAvatar person={people.get(r.requested_by)} className="h-5 w-5" />
                    {personName(people.get(r.requested_by))}
                  </span>
                  <span className={cn("text-[13px]", late ? "font-semibold text-danger" : "text-ink")}>
                    {r.needed_by ? `Needed ${day(r.needed_by)}` : "No deadline"}
                  </span>
                  <span className="text-[13px] text-ink-muted">
                    {r.status === "live" && r.live_at ? `Live ${formatDate(r.live_at.slice(0, 10), "d MMM")}` : r.live_from ? `Live ${day(r.live_from)}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="surface px-4 py-8 text-center text-sm text-ink-muted">
          {show === "open" ? `Nothing open. Need something for ${CHANNEL_LABELS[channel]}? Ask Design with New request.` : "Nothing here yet."}
        </p>
      )}

      <Sheet open={creating} onOpenChange={setCreating}>
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto bg-white p-0 sm:max-w-lg">
          <SheetHeader className="px-5 pb-2 pt-5">
            <SheetDescription className="text-xs">{CHANNEL_LABELS[channel]}</SheetDescription>
            <SheetTitle className="pr-8 text-xl text-ink">Ask Design</SheetTitle>
          </SheetHeader>
          <div className="px-5 pb-6">{creating && <NewRequest channel={channel} links={shared.links} onDone={() => setCreating(false)} />}</div>
        </SheetContent>
      </Sheet>
      <RequestSheet r={current} onClose={() => setOpen(null)} {...shared} />
    </>
  );
}

function NewRequest({ channel, links, onDone, existing }: { channel: Channel; links: LinkOption[]; onDone: () => void; existing?: CreativeRequest }) {
  const [id] = useState(() => existing?.id ?? crypto.randomUUID());
  const [refs, setRefs] = useState<{ path: string; name: string }[]>(
    () => existing?.ref_paths.map((path) => ({ path, name: path.split("/").pop()!.replace(/^\d+-/, "") })) ?? [],
  );
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();
  const file = useRef<HTMLInputElement>(null);

  async function add(files: FileList | File[] | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const list = [...files].slice(0, 10 - refs.length);
      const paths = await upload(id, "refs", list);
      setRefs((x) => [...x, ...paths.map((path, i) => ({ path, name: list[i].name }))]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function save(form: FormData) {
    const input: RequestInput = {
      title: String(form.get("title") ?? ""),
      formats: String(form.get("formats") ?? ""),
      brief: String(form.get("brief") ?? ""),
      project_id: String(form.get("project_id") ?? ""),
      needed_by: String(form.get("needed_by") ?? ""),
      live_from: String(form.get("live_from") ?? ""),
      live_to: String(form.get("live_to") ?? ""),
      ref_paths: refs.map((r) => r.path),
    };
    start(async () => {
      const res = existing ? await updateRequest(id, input) : await createRequest(id, channel, input);
      if (!res.ok) return void toast.error(res.error);
      toast.success(existing ? "Saved." : "Sent to Design.");
      onDone();
    });
  }

  return (
    <form action={save} className="flex flex-col gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="cr-title">What do you need?</Label>
        <Input id="cr-title" name="title" required maxLength={200} autoFocus={!existing} defaultValue={existing?.title} placeholder="e.g. 11.11 countdown posts" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cr-formats">
          Formats <span className="font-normal text-ink-muted">(optional)</span>
        </Label>
        <Input id="cr-formats" name="formats" maxLength={500} defaultValue={existing?.formats ?? ""} placeholder="e.g. Post 1:1 ×3, Story ×3" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cr-brief">Brief and copy</Label>
        <Textarea
          id="cr-brief"
          name="brief"
          rows={4}
          maxLength={5000}
          defaultValue={existing?.brief ?? ""}
          // A pasted screenshot is added to the references.
          onPaste={(e) => {
            const images = imagesIn(e.clipboardData);
            if (!images.length || e.clipboardData.getData("text/html").includes("<table")) return;
            e.preventDefault();
            void add(images);
          }}
          placeholder="What it says, the look, anything Design should know. Paste a screenshot or cells from a sheet."
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cr-link">
          Link to <span className="font-normal text-ink-muted">(optional)</span>
        </Label>
        <select id="cr-link" name="project_id" defaultValue={existing?.project_id ?? ""} className="h-10 w-full field px-3 text-sm">
          <option value="">Nothing</option>
          {(["campaign", "project", "partnership"] as const).map((k) => {
            const list = links.filter((l) => l.kind === k);
            return list.length ? (
              <optgroup key={k} label={DOMAINS[k].plural}>
                {list.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </optgroup>
            ) : null;
          })}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cr-needed">Needed by</Label>
        <Input id="cr-needed" name="needed_by" type="date" required defaultValue={existing?.needed_by ?? ""} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="cr-from">
            Goes live <span className="font-normal text-ink-muted">(optional)</span>
          </Label>
          <Input id="cr-from" name="live_from" type="date" defaultValue={existing?.live_from ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cr-to">Until</Label>
          <Input id="cr-to" name="live_to" type="date" defaultValue={existing?.live_to ?? ""} />
        </div>
      </div>
      {refs.length > 0 && (
        <ul className="space-y-1 text-sm">
          {refs.map((r) => (
            <li key={r.path} className="flex items-center gap-2">
              <Paperclip className="h-3.5 w-3.5 text-ink-muted" />
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              <button type="button" aria-label={`Remove ${r.name}`} onClick={() => setRefs((x) => x.filter((y) => y.path !== r.path))} className="text-ink-muted hover:text-ink">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input ref={file} type="file" multiple hidden onChange={(e) => add(e.target.files ? [...e.target.files] : null).finally(() => (e.target.value = ""))} />
      <Button type="button" variant="outline" onClick={() => file.current?.click()} disabled={uploading || refs.length >= 10}>
        <ImagePlus className="h-4 w-4" /> {uploading ? "Uploading…" : "Add references, KV or logos"}
      </Button>
      <Button type="submit" disabled={pending || uploading}>
        {pending ? "Saving…" : existing ? "Save changes" : "Send to Design"}
      </Button>
      {!existing && <p className="text-center text-xs text-ink-muted">Design is told by email. You&apos;ll hear back when it&apos;s ready to review.</p>}
    </form>
  );
}

// ---------------------------------------------------------------------------
// One request: details, files and the next step for whoever is looking
// ---------------------------------------------------------------------------

function RequestSheet({ r, onClose, ...shared }: Shared & { r: CreativeRequest | undefined; onClose: () => void }) {
  return (
    <Sheet open={!!r} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto bg-white p-0 sm:max-w-lg">
        {r && (
          <>
            <SheetHeader className="px-5 pb-2 pt-5">
              <SheetDescription className="flex items-center gap-2 text-xs">
                <ChannelTag channel={r.channel} /> <StatusChip r={r} />
              </SheetDescription>
              <SheetTitle className="pr-8 text-xl text-ink">{r.title}</SheetTitle>
            </SheetHeader>
            <div className="px-5 pb-6">
              <RequestDetails r={r} onClose={onClose} {...shared} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function FileList({ paths, urls, title }: { paths: string[]; urls: Record<string, string>; title: string }) {
  if (!paths.length) return null;
  const images = paths.filter(isImage);
  const others = paths.filter((p) => !isImage(p));
  return (
    <div className="space-y-2">
      <p className="kicker">{title}</p>
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {images.map((p) =>
            urls[p] ? (
              <a key={p} href={urls[p]} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-[10px] bg-subtle">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={urls[p]} alt="" className="h-full w-full object-cover" />
              </a>
            ) : (
              <span key={p} className="aspect-square rounded-[10px] bg-subtle" />
            ),
          )}
        </div>
      )}
      {others.map((p) => (
        <a key={p} href={urls[p]} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-brand-primary hover:underline">
          <Download className="h-3.5 w-3.5" /> {p.split("/").pop()?.replace(/^\d+-/, "")}
        </a>
      ))}
    </div>
  );
}

function RequestDetails({ r, onClose, ...shared }: Shared & { r: CreativeRequest; onClose: () => void }) {
  const people = new Map(shared.people.map((p) => [p.id, p]));
  const link = shared.links.find((l) => l.id === r.project_id);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const asker = r.requested_by === shared.viewerId;
  // Anyone in Design can work on it; the team decides between them.
  const canDesign = shared.isDesign;
  // Files are grouped by the version they were made for, newest first.
  const versions = [...new Set(r.art_paths.map(fileVersion))].sort((a, b) => b - a);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string, close = false) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? "Something went wrong.");
      toast.success(done);
      if (close) onClose();
    });

  async function addFiles(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    try {
      const paths = await upload(r.id, `art/v${r.version + 1}`, files.slice(0, 20));
      const res = await addArtwork(r.id, paths);
      if (!res.ok) toast.error(res.error);
      else toast.success(paths.length === 1 ? "File added." : `${paths.length} files added.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  if (editing)
    return (
      <div className="space-y-3">
        <NewRequest channel={r.channel} links={shared.links} existing={r} onDone={() => setEditing(false)} />
        <Button variant="ghost" className="w-full" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    );

  const row = (label: string, value: React.ReactNode) =>
    value ? (
      <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2 py-1.5 text-sm">
        <span className="text-ink-muted">{label}</span>
        <span className="min-w-0 text-ink">{value}</span>
      </div>
    ) : null;

  const revisionLabel = r.status === "in_review" ? "Ask for changes" : "Ask for a revision";

  return (
    <div className="flex flex-col gap-4">
      {r.change_note && r.status === "in_design" && (
        <p className="rounded-[12px] bg-warning-soft px-3 py-2 text-sm text-warning-ink">
          <span className="font-semibold">Revision asked:</span> {r.change_note}
        </p>
      )}
      <div className="divide-y divide-line">
        {row("Asked by", personName(people.get(r.requested_by)))}
        {row("Designer", r.designer_id ? personName(people.get(r.designer_id)) : "Not taken yet")}
        {row("Needed by", day(r.needed_by))}
        {row("Goes live", r.live_from ? `${day(r.live_from)}${r.live_to ? ` to ${day(r.live_to)}` : ""}` : null)}
        {row("Formats", r.formats)}
        {row("Part of", link ? `${DOMAINS[link.kind].label} · ${link.name}` : null)}
        {row(
          "Brief",
          r.brief && (
            <div className="whitespace-pre-wrap">
              <PlainText text={r.brief} />
            </div>
          ),
        )}
      </div>
      {asker && r.status !== "live" && (
        <Button variant="outline" size="sm" className="self-start" onClick={() => setEditing(true)}>
          Edit request
        </Button>
      )}
      <FileList paths={r.ref_paths} urls={shared.urls} title="References" />
      {versions.map((v, i) => (
        <FileList
          key={v}
          paths={r.art_paths.filter((p) => fileVersion(p) === v)}
          urls={shared.urls}
          title={`From Design · version ${v}${i === 0 ? (v > r.version ? " (in progress)" : " (latest)") : ""}`}
        />
      ))}

      {/* Design */}
      {shared.isDesign && isOpen(r) && r.status !== "approved" && (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-muted">Who&apos;s on it</span>
          <select
            value={r.designer_id ?? ""}
            disabled={pending}
            onChange={(e) => e.target.value && run(() => takeRequest(r.id, e.target.value), e.target.value === shared.viewerId ? "Noted, you're on it." : "Noted. They've been told.")}
            className="h-9 flex-1 field px-2 text-sm"
          >
            <option value="">Not decided</option>
            {shared.designers.map((d) => (
              <option key={d.id} value={d.id}>
                {personName(d)}
              </option>
            ))}
          </select>
        </label>
      )}
      {canDesign && (r.status === "in_design" || r.status === "requested") && (
        <>
          <input
            ref={file}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              void addFiles(files);
            }}
          />
          <Button variant="outline" onClick={() => file.current?.click()} disabled={uploading}>
            <Upload className="h-4 w-4" /> {uploading ? "Uploading…" : `Upload files for version ${r.version + 1}`}
          </Button>
          <Button disabled={pending || !r.art_paths.some((p) => fileVersion(p) > r.version)} onClick={() => run(() => sendForReview(r.id), "Sent for review. They've been told.", true)}>
            Send for review
          </Button>
        </>
      )}
      {canDesign && ["requested", "in_design", "in_review", "approved"].includes(r.status) && (
        <Button variant="outline" disabled={pending} onClick={() => run(() => markRequestComplete(r.id), "Marked complete.", true)}>
          Mark complete
        </Button>
      )}

      {/* Whoever asked */}
      {asker && r.status === "in_review" && note === null && (
        <Button disabled={pending} onClick={() => run(() => approveRequest(r.id), "Approved.")}>
          Approve
        </Button>
      )}
      {asker && ["in_review", "approved", "done", "live"].includes(r.status) && note === null && (
        <Button variant="outline" disabled={pending} onClick={() => setNote("")}>
          {revisionLabel}
        </Button>
      )}
      {asker && note !== null && (
        <div className="space-y-2">
          <Textarea autoFocus rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What needs to change?" />
          <div className="flex gap-2">
            <Button disabled={pending || !note.trim()} onClick={() => run(() => askForChanges(r.id, note), "Sent back to Design.", true)}>
              Send back
            </Button>
            <Button variant="ghost" onClick={() => setNote(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {asker && (r.status === "approved" || r.status === "done") && note === null && (
        <Button disabled={pending} onClick={() => run(() => markRequestLive(r.id), "Marked live.", true)}>
          It&apos;s posted, mark live
        </Button>
      )}
      {asker && (isOpen(r) || r.status === "done") && note === null && (
        <Button variant="ghost" className="text-danger hover:text-danger/80" disabled={pending} onClick={() => run(() => cancelRequest(r.id), "Cancelled.", true)}>
          Cancel this request
        </Button>
      )}

      <RequestComments requestId={r.id} comments={shared.comments.filter((c) => c.request_id === r.id)} people={people} viewerId={shared.viewerId} />
    </div>
  );
}

/** Comments under a request, with pasted screenshots and cells from a sheet. */
function RequestComments({
  requestId,
  comments,
  people,
  viewerId,
}: {
  requestId: string;
  comments: RequestComment[];
  people: Map<string, PersonRef>;
  viewerId: string;
}) {
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const pasted = usePastedImages();
  const post = () =>
    start(async () => {
      const res = await addRequestComment(requestId, body, pasted.images);
      if (!res.ok) return void toast.error(res.error);
      setBody("");
      pasted.clear();
    });
  return (
    <section className="space-y-3 border-t border-line pt-4">
      <p className="kicker">Comments</p>
      {comments.length === 0 && <p className="text-sm text-ink-muted">No comments yet.</p>}
      <ul className="space-y-3">
        {comments.map((c) => (
          <li key={c.id} className="flex gap-2.5">
            <PersonAvatar person={people.get(c.author_id)} className="mt-0.5 h-6 w-6" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium">{personName(people.get(c.author_id))}</span>
                <span className="text-ink-muted">{formatDate(c.created_at.slice(0, 10), "d MMM")}</span>
                {c.author_id === viewerId && (
                  <button
                    type="button"
                    className="ml-auto text-ink-muted hover:text-danger"
                    onClick={() => start(async () => void (await deleteRequestComment(c.id)))}
                  >
                    Delete
                  </button>
                )}
              </div>
              {c.body && (
                <div className="mt-0.5 whitespace-pre-wrap break-words text-sm">
                  <PlainText text={c.body} />
                </div>
              )}
              <CommentImages paths={c.image_paths} />
            </div>
          </li>
        ))}
      </ul>
      <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} onPaste={pasted.onPaste} placeholder="Write a comment, or paste a screenshot" />
      <PendingImages state={pasted} />
      <Button size="sm" disabled={pending || pasted.uploading || (!body.trim() && !pasted.images.length)} onClick={post}>
        Comment
      </Button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Design: everything assigned to them, in the order to do it
// ---------------------------------------------------------------------------

export type WebItem = { id: string; title: string; sub: string; due: string; late: boolean };

export function DesignRequests({
  requests,
  web,
  openId,
  ...shared
}: Shared & { requests: CreativeRequest[]; web: WebItem[]; openId: string | null }) {
  // Everything comes to the whole team; the team decides who does what.
  const [onlyMine, setOnlyMine] = useState(false);
  const [open, setOpen] = useOpenRequest(requests, openId);
  const people = new Map(shared.people.map((p) => [p.id, p]));
  const current = requests.find((r) => r.id === open);
  const g = designGroups(requests, shared.today, onlyMine ? shared.viewerId : undefined);

  const who = (r: CreativeRequest) => (r.designer_id ? personName(people.get(r.designer_id)) : "nobody on it yet");
  const item = (r: CreativeRequest, hint: React.ReactNode, cta: string, late = false) => (
    <li key={r.id}>
      <button
        type="button"
        onClick={() => setOpen(r.id)}
        className={cn(
          "relative grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-4 py-3 text-left hover:bg-subtle/60 sm:grid-cols-[auto_minmax(0,1fr)_auto]",
          late && "before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-danger",
        )}
      >
        <ChannelTag channel={r.channel} />
        <span className="min-w-0">
          <span className="block font-semibold text-ink">{r.title}</span>
          <span className="text-xs text-ink-muted">
            For {personName(people.get(r.requested_by))} · {hint} · <span className={r.designer_id ? "text-ink" : ""}>{who(r)}</span>
          </span>
        </span>
        <span className="col-span-2 justify-self-start rounded-[10px] border border-line px-2.5 py-1 text-xs font-semibold text-ink sm:col-span-1">{cta}</span>
      </button>
    </li>
  );

  const group = (title: string, items: React.ReactNode[], tone?: "late") =>
    items.length > 0 && (
      <section key={title}>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-ink">
          {title}
          <span className={cn("rounded-full px-2 text-xs", tone === "late" ? "bg-danger-soft text-danger-ink" : "bg-subtle text-ink-muted")}>{items.length}</span>
        </h2>
        <ul className="divide-y divide-line overflow-hidden surface">{items}</ul>
      </section>
    );

  const due = (r: CreativeRequest) =>
    !r.needed_by ? "no deadline" : r.needed_by === shared.today ? "due today" : `${r.needed_by < shared.today ? "was due" : "due"} ${day(r.needed_by)}`;

  // Homepage banners still to make sit in the same list.
  const lateWeb = onlyMine ? [] : web.filter((w) => w.late);
  const restWeb = onlyMine ? [] : web.filter((w) => !w.late);
  const webItem = (w: WebItem) => (
    <li key={w.id}>
      <Link
        href={`/placements?tab=web&open=${w.id}`}
        className={cn(
          "relative grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-4 py-3 hover:bg-subtle/60 sm:grid-cols-[auto_minmax(0,1fr)_auto]",
          w.late && "before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-danger",
        )}
      >
        <ChannelTag channel="web" />
        <span className="min-w-0">
          <span className="block font-semibold text-ink">{w.title}</span>
          <span className="text-xs text-ink-muted">{w.sub}</span>
        </span>
        <span className="col-span-2 justify-self-start rounded-[10px] border border-line px-2.5 py-1 text-xs font-semibold text-ink sm:col-span-1">Upload banner</span>
      </Link>
    </li>
  );
  const sections = [
    group("Late or due today", [...g.due.map((r) => item(r, due(r), "Upload & send for review", !!r.needed_by && r.needed_by < shared.today)), ...lateWeb.map(webItem)], "late"),
    group("Revision asked", g.changes.map((r) => item(r, `“${r.change_note}”`, "Upload new version"))),
    group("Coming up", [...g.upcoming.map((r) => item(r, due(r), "Open")), ...restWeb.map(webItem)]),
    group("Waiting on others", g.waiting.map((r) => item(r, r.status === "approved" ? "approved, waiting to go live" : "sent for review", "Nothing to do"))),
  ].filter(Boolean);

  return (
    <>
      <div className="mb-4 inline-flex rounded-[12px] bg-subtle p-0.5 text-sm">
        {([false, true] as const).map((k) => (
          <button
            key={String(k)}
            type="button"
            aria-pressed={onlyMine === k}
            onClick={() => setOnlyMine(k)}
            className={cn("rounded-[10px] px-3 py-1 font-semibold", onlyMine === k ? "bg-white text-ink shadow-sm" : "text-ink-muted hover:text-ink")}
          >
            {k ? "Only mine" : "Whole team"}
          </button>
        ))}
      </div>
      <div className="space-y-6">
        {sections.length ? sections : <p className="surface px-4 py-8 text-center text-sm text-ink-muted">{onlyMine ? "Nothing you're on right now." : "Nothing waiting on Design."}</p>}
      </div>
      <RequestSheet r={current} onClose={() => setOpen(null)} {...shared} />
    </>
  );
}
