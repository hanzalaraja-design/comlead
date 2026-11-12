"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { BellRing, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { DAYS, NOTIFY_GROUPS } from "@/lib/notification-kinds";
import { cn } from "@/lib/utils";
import {
  removePushSubscription,
  saveNotificationSettings,
  savePushSubscription,
  sendTestPush,
  type NotificationSettingsInput,
} from "@/app/(app)/notifications/actions";

export type NotificationSettingsValue = {
  feed_off: string[];
  push_off: string[];
  quiet_from: string | null;
  quiet_to: string | null;
  quiet_days: number[];
  paused_until: string | null;
};

// Every hour, as "HH:00".
const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);
const hourLabel = (v: string) => {
  const h = Number(v.slice(0, 2));
  return `${h % 12 || 12}:00 ${h < 12 ? "am" : "pm"}`;
};
const PAUSES = [
  { hours: 1, label: "1 hour" },
  { hours: 4, label: "4 hours" },
  { hours: 12, label: "12 hours" },
  { hours: 24, label: "1 day" },
  { hours: 24 * 7, label: "1 week" },
];

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Computer";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "browser";
  return `${os} · ${browser}`;
}

type DeviceState = "checking" | "unsupported" | "ios-install" | "blocked" | "off" | "on";

/** Turn push on or off for the phone or browser being used now. */
function ThisDevice({ vapidKey, devices }: { vapidKey: string | null; devices: number }) {
  const [state, setState] = useState<DeviceState>("checking");
  const [pending, start] = useTransition();

  useEffect(() => {
    (async () => {
      const ios = /iPhone|iPad/.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return setState(ios && !standalone ? "ios-install" : "unsupported");
      if (Notification.permission === "denied") return setState("blocked");
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  const turnOn = () =>
    start(async () => {
      if (!vapidKey) return void toast.error("Push isn't set up on this site yet. Ask an Admin.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "blocked" : "off");
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) });
      const res = await savePushSubscription(sub.toJSON(), deviceName());
      if (!res.ok) return void toast.error(res.error);
      setState("on");
      toast.success("Notifications are on for this device.");
    });

  const turnOff = () =>
    start(async () => {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
    });

  const test = () =>
    start(async () => {
      const res = await sendTestPush();
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.data?.devices ? `Sent to ${res.data.devices} device${res.data.devices === 1 ? "" : "s"}.` : "No device has push turned on yet.");
    });

  const text: Record<DeviceState, string> = {
    checking: "Checking this device…",
    unsupported: "This browser can't show notifications. Try Chrome, Edge, Safari or Firefox.",
    "ios-install": "On iPhone, first add Highfy Tasks to your home screen: tap Share, then Add to Home Screen. Open it from there and come back here.",
    blocked: "Notifications are blocked for this site. Allow them in the browser's site settings, then reload.",
    off: "Get notifications on this device, even when Highfy Tasks is closed.",
    on: "This device gets notifications.",
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-brand-bg px-4 py-3">
      <Smartphone className="h-5 w-5 shrink-0 text-brand-primary" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-ink">{state === "on" ? "Push is on here" : "Push on this device"}</p>
        <p className="text-[13px] text-ink-muted">
          {text[state]}
          {devices > 0 && ` ${devices} device${devices === 1 ? "" : "s"} turned on in all.`}
        </p>
      </div>
      <div className="flex gap-2">
        {state === "off" && (
          <Button size="sm" disabled={pending} onClick={turnOn}>
            <BellRing className="h-4 w-4" /> Turn on
          </Button>
        )}
        {state === "on" && (
          <Button size="sm" variant="outline" disabled={pending} onClick={turnOff}>
            Turn off here
          </Button>
        )}
        {devices > 0 && (
          <Button size="sm" variant="outline" disabled={pending} onClick={test}>
            Send a test
          </Button>
        )}
      </div>
    </div>
  );
}

export function NotificationSettings({ initial, vapidKey, devices }: { initial: NotificationSettingsValue; vapidKey: string | null; devices: number }) {
  const [v, setV] = useState(initial);
  const [, start] = useTransition();
  const paused = !!v.paused_until && new Date(v.paused_until) > new Date();

  function save(next: NotificationSettingsValue, extra?: Partial<NotificationSettingsInput>) {
    const before = v;
    setV(next);
    start(async () => {
      const res = await saveNotificationSettings({
        feed_off: next.feed_off,
        push_off: next.push_off,
        quiet_from: next.quiet_from,
        quiet_to: next.quiet_to,
        quiet_days: next.quiet_days,
        ...extra,
      });
      if (!res.ok) {
        setV(before);
        toast.error(res.error);
      }
    });
  }
  const toggle = (list: "feed_off" | "push_off", key: string, on: boolean) =>
    save({ ...v, [list]: on ? v[list].filter((k) => k !== key) : [...v[list], key] });

  return (
    <div className="space-y-4">
      <ThisDevice vapidKey={vapidKey} devices={devices} />

      {NOTIFY_GROUPS.map((g) => (
        <div key={g.title} className="overflow-hidden rounded-[14px] border border-line">
          <div className="flex items-center bg-subtle px-4 py-2.5">
            <h3 className="flex-1 text-sm font-bold text-ink">{g.title}</h3>
            <span className="w-20 text-center text-xs font-semibold text-ink-muted">On this page</span>
            <span className="w-16 text-center text-xs font-semibold text-ink-muted">Push</span>
          </div>
          {g.kinds.map((k) => (
            <div key={k.key} className="flex items-center border-t border-line px-4 py-2.5">
              <div className="min-w-0 flex-1 pr-2">
                <p className="text-sm text-ink">{k.label}</p>
                {k.hint && <p className="text-[12.5px] text-ink-muted">{k.hint}</p>}
              </div>
              <span className="flex w-20 justify-center">
                <Switch checked={!v.feed_off.includes(k.key)} aria-label={`${k.label} on the Notifications page`} onCheckedChange={(on) => toggle("feed_off", k.key, on)} />
              </span>
              <span className="flex w-16 justify-center">
                <Switch checked={!v.push_off.includes(k.key)} aria-label={`${k.label} as push`} onCheckedChange={(on) => toggle("push_off", k.key, on)} />
              </span>
            </div>
          ))}
        </div>
      ))}

      <div className="overflow-hidden rounded-[14px] border border-line">
        <div className="bg-subtle px-4 py-2.5">
          <h3 className="text-sm font-bold text-ink">Quiet time</h3>
          <p className="text-[12.5px] text-ink-muted">No push then. Everything still shows on the Notifications page.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 text-sm">
          <span>No push between</span>
          <select
            aria-label="Quiet from"
            value={v.quiet_from?.slice(0, 5) ?? ""}
            onChange={(e) => save({ ...v, quiet_from: e.target.value || null, quiet_to: e.target.value ? (v.quiet_to ?? "09:00") : null })}
            className="h-9 rounded-[10px] border border-line bg-white px-2"
          >
            <option value="">Off</option>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </select>
          <span>and</span>
          <select
            aria-label="Quiet until"
            value={v.quiet_to?.slice(0, 5) ?? ""}
            disabled={!v.quiet_from}
            onChange={(e) => save({ ...v, quiet_to: e.target.value || null })}
            className="h-9 rounded-[10px] border border-line bg-white px-2 disabled:opacity-50"
          >
            {!v.quiet_from && <option value="">—</option>}
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 text-sm">
          <span className="mr-1">No push on</span>
          {DAYS.map((d, i) => {
            const on = v.quiet_days.includes(i);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => save({ ...v, quiet_days: on ? v.quiet_days.filter((x) => x !== i) : [...v.quiet_days, i] })}
                className={cn("h-8 rounded-full border px-3 text-[13px] font-semibold", on ? "border-ink bg-ink text-white" : "border-line bg-white text-ink")}
              >
                {d}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 text-sm">
          {paused ? (
            <>
              <span>
                Push is paused until{" "}
                <b>{new Date(v.paused_until!).toLocaleString("en-GB", { timeZone: "Asia/Karachi", weekday: "short", hour: "numeric", minute: "2-digit", hour12: true })}</b>.
              </span>
              <Button size="sm" variant="outline" onClick={() => save({ ...v, paused_until: null }, { pause_hours: 0 })}>
                Resume now
              </Button>
            </>
          ) : (
            <>
              <span>Pause all push for</span>
              {PAUSES.map((p) => (
                <button
                  key={p.hours}
                  type="button"
                  onClick={() => save({ ...v, paused_until: new Date(Date.now() + p.hours * 3600_000).toISOString() }, { pause_hours: p.hours })}
                  className="h-8 rounded-full border border-line bg-white px-3 text-[13px] font-semibold text-ink hover:border-ink/40"
                >
                  {p.label}
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
