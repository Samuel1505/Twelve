"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { listAlerts } from "@/lib/api";
import { AlertRow } from "@/lib/alerts";
import { API_URL, MAINNET } from "@/lib/config";
import { cn } from "@/lib/cn";
import { AlertItem } from "./alert-item";

const FILTERS = [
  { id: "", label: "All" },
  { id: "HIGH", label: "High" },
  { id: "MEDIUM", label: "Medium" },
  { id: "INFO", label: "Info" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];

type Load = "loading" | "ready" | "offline";

/** Full mainnet alert history, newest first, with live additions. Operational (OPS) alerts are not product alerts. */
export function AlertsFeed() {
  const [filter, setFilter] = useState<Filter>("");
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [load, setLoad] = useState<Load>("loading");
  const [more, setMore] = useState(false);
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const filterRef = useRef<Filter>("");
  filterRef.current = filter;

  const fetchPage = useCallback(async (f: Filter, after: string | null) => {
    const r = await listAlerts({ chainId: MAINNET.chainId, ...(f ? { severity: f } : {}), cursor: after, limit: 25 });
    if (!r.ok) return null;
    return { alerts: r.value.alerts.filter((a) => a.severity !== "OPS"), next: r.value.alerts.length < 25 ? null : r.value.nextCursor };
  }, []);

  useEffect(() => {
    let stale = false;
    setLoad("loading");
    void fetchPage(filter, null).then((p) => {
      if (stale) return;
      if (!p) return setLoad("offline");
      setRows(p.alerts);
      setCursor(p.next);
      setLoad("ready");
    });
    return () => {
      stale = true;
    };
  }, [filter, fetchPage]);

  useEffect(() => {
    const es = new EventSource(`${API_URL}/v1/alerts/stream`);
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.onmessage = (m) => {
      const a = AlertRow.safeParse(JSON.parse(m.data));
      if (!a.success || a.data.chainId !== MAINNET.chainId || a.data.severity === "OPS") return;
      if (filterRef.current && a.data.severity !== filterRef.current) return;
      setRows((prev) => [a.data, ...prev.filter((x) => x.id !== a.data.id)]);
    };
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      es.close();
      clearInterval(t);
    };
  }, []);

  const loadMore = async () => {
    if (!cursor) return;
    setMore(true);
    const p = await fetchPage(filter, cursor);
    setMore(false);
    if (!p) return setLoad("offline");
    setRows((prev) => [...prev, ...p.alerts.filter((a) => !prev.some((x) => x.id === a.id))]);
    setCursor(p.next);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" aria-label="Severity" className="flex rounded-lg border border-line bg-sunken p-0.5">
          {FILTERS.map((f) => (
            <button key={f.id || "all"} role="radio" aria-checked={filter === f.id} onClick={() => setFilter(f.id)}
              className={cn("pressable h-7 rounded-md px-3 text-[13px]",
                filter === f.id ? "bg-elev-2 text-fg shadow-[0_0_0_1px_var(--line-strong)]" : "text-subtle hover:text-fg")}>
              {f.label}
            </button>
          ))}
        </div>
        <span className="flex items-center gap-2 text-[12px] text-subtle">
          <span aria-hidden className={cn("size-1.5 rounded-full", live ? "bg-ok" : "bg-subtle")} />
          {live ? "Streaming new alerts" : "Not streaming"}
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-elev">
        {load === "loading" && (
          <div aria-hidden className="divide-y divide-line">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="space-y-2.5 px-5 py-4">
                <div className="h-4 w-56 rounded bg-elev-2" />
                <div className="h-3 w-80 max-w-full rounded bg-elev-2" />
              </div>
            ))}
          </div>
        )}
        {load === "offline" && (
          <p className="px-5 py-6 text-[14px] leading-relaxed text-muted">
            The alert history isn&apos;t reachable right now. The monitor keeps recording; reload in a minute.
          </p>
        )}
        {load === "ready" && rows.length === 0 && (
          <p className="px-5 py-6 text-[14px] leading-relaxed text-muted">
            {filter ? `No ${filter.toLowerCase()}-severity alerts on mainnet yet.` : "No alerts on mainnet yet."} New ones
            appear here within seconds of their block.
          </p>
        )}
        {load === "ready" && rows.length > 0 && (
          <ul className="divide-y divide-line">
            {rows.map((a) => (
              <li key={a.id} className="ticker-row px-5 py-4">
                <AlertItem a={a} now={now} detailed />
              </li>
            ))}
          </ul>
        )}
      </div>

      {load === "ready" && cursor && (
        <div className="flex justify-center">
          <Button onClick={() => void loadMore()} disabled={more}>{more ? "Loading…" : "Older alerts"}</Button>
        </div>
      )}
    </div>
  );
}
