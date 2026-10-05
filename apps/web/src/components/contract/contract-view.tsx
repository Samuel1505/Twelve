"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertItem } from "@/components/alerts/alert-item";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/unit-chip";
import { type ApiError, type ApiResult, type Status, ScanEvent, getStatus, scanEventsUrl, startScan } from "@/lib/api";
import { plural, utc } from "@/lib/format";
import { apiErrorSentence, outcomeFor } from "@/lib/scan-states";
import { cn } from "@/lib/cn";
import { AttestationPanel, BuildFacts, VerifyPanel } from "./attestation-panel";
import { FindingCard } from "./finding-card";
import { ScanProgress } from "./scan-progress";

const TERMINAL = new Set([
  "DONE", "NOT_A_CONTRACT", "UNSUPPORTED", "NOT_VERIFIED", "MATCH_FAILED", "COMPILE_FAILED", "ANALYZER_ERROR",
  "ATTEST_FAILED", "CHAIN_MISMATCH", "FETCH_FAILED", "CONFIG", "WITHHELD",
]);

type Scan = { id: string; state: string; startedAt: number; error?: ScanEvent["error"]; attestTx?: string };

/** Report for one address; scans it automatically when there is no report yet. */
export function ContractView({ address, initial }: { address: string; initial: ApiResult<Status> }) {
  const [status, setStatus] = useState<Status | null>(initial.ok ? initial.value : null);
  const [apiError, setApiError] = useState<ApiError | null>(initial.ok ? null : initial.error);
  const [scan, setScan] = useState<Scan | null>(null);
  const es = useRef<EventSource | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    const r = await getStatus(address);
    if (r.ok) {
      setStatus(r.value);
      setApiError(null);
    } else setApiError(r.error);
  }, [address]);

  const start = useCallback(async () => {
    es.current?.close();
    setApiError(null);
    const r = await startScan(address);
    if (!r.ok) {
      setApiError(r.error);
      return;
    }
    const id = r.value.scanId;
    setScan({ id, state: "QUEUED", startedAt: Date.now() });
    const src = new EventSource(scanEventsUrl(id));
    es.current = src;
    src.onmessage = (m) => {
      const ev = ScanEvent.safeParse(JSON.parse(m.data));
      if (!ev.success) return;
      setScan((s) => s && s.id === ev.data.scanId ? {
        ...s, state: ev.data.state,
        ...(ev.data.error ? { error: ev.data.error } : {}),
        ...(ev.data.attestTx ? { attestTx: ev.data.attestTx } : {}),
      } : s);
      if (TERMINAL.has(ev.data.state)) {
        src.close();
        void refresh();
      }
    };
    // the server replays every event on reconnect, so a dropped stream only needs to be reopened by the browser
  }, [address, refresh]);

  // a stranger pasting an address expects a result, not a button: scan when nothing is known yet
  const auto = useRef(false);
  useEffect(() => {
    if (!auto.current && initial.ok && !initial.value.report && !initial.value.withheld) {
      auto.current = true;
      void start();
    }
    return () => es.current?.close();
  }, [initial, start]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const running = scan !== null && !TERMINAL.has(scan.state);
  const outcome = scan && TERMINAL.has(scan.state) && scan.state !== "DONE"
    ? outcomeFor(scan.state, scan.error?.code, scan.error?.message)
    : !scan && status?.withheld ? outcomeFor("WITHHELD") : null;
  const report = status?.report ?? null;
  const core = report?.core;
  const target = core && core.target.kind !== "source" ? core.target : null;
  const sourceAddresses = target?.implementation ? [target.implementation.address, address] : [address];

  return (
    <div className="mx-auto max-w-[1120px] px-5 pb-24 pt-10 sm:px-8 sm:pt-14">
      <Identity address={status?.address ?? address} kind={target?.kind} implementation={target?.implementation?.address}
        onRescan={report && !running ? start : undefined} />

      <div className="mt-10 space-y-6">
        {apiError && <Notice title="Can't reach Twelve" body={apiErrorSentence(apiError)} tone="warn"
          action={<Button onClick={() => (status ? start() : refresh())}>Try again</Button>} />}
        {running && <ScanProgress state={scan.state} startedAt={scan.startedAt} />}
        {outcome && (
          <Notice title={outcome.title} body={outcome.body} tone={outcome.tone} detail={outcome.detail}
            action={outcome.retry ? <Button onClick={() => void start()}>Scan again</Button> : undefined}
            footer={outcome.monitorOnly ? <>The monitor&apos;s alerts for this address are listed below.</> : undefined} />
        )}
      </div>

      {report && core && status && (
        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12">
          <div className="min-w-0 space-y-14">
            <Verdict status={status} />
            {core.findings.length > 0 && (
              <section className="space-y-14">
                {core.findings.map((f, i) => <FindingCard key={f.id} f={f} index={i} sourceAddresses={sourceAddresses} />)}
              </section>
            )}
            <VerifyPanel hash={report.reportHash} />
            {core.coverage.unsupported.length > 0 && (
              <section className="rounded-2xl border border-line">
                <h2 className="border-b border-line px-5 py-3.5 text-[14px] font-medium text-fg">Not followed</h2>
                <ul className="divide-y divide-line text-[13px]">
                  {core.coverage.unsupported.map((u) => (
                    <li key={u.function} className="grid gap-1 px-5 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <span className="num text-fg">{u.function}</span><span className="text-muted">{u.reason}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
          <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start">
            <AttestationPanel status={status} attestTx={scan?.attestTx} />
            <BuildFacts status={status} />
          </aside>
        </div>
      )}

      {status && (scan === null || !running) && (
        <section className="mt-16">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-fg">Live monitor</h2>
              <p className="mt-1 text-[13px] text-muted">USDC movements of this address that matched a detector, newest first.</p>
            </div>
            <Link href="/alerts" className="text-[13px] text-muted underline decoration-line-strong underline-offset-[3px] hover:text-fg">All alerts</Link>
          </div>
          {status.alerts.length === 0 ? (
            <p className="rounded-2xl border border-line px-5 py-4 text-[13px] text-muted">
              No alerts. The monitor reads every USDC movement on mainnet and hasn&apos;t flagged this address.
            </p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-elev">
              {status.alerts.map((a) => <li key={a.id} className="px-5 py-3.5"><AlertItem a={a} now={now} showAddress={false} detailed /></li>)}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function Identity({ address, kind, implementation, onRescan }: {
  address: string; kind?: string | undefined; implementation?: string | undefined; onRescan?: (() => void) | undefined;
}) {
  const proxy = kind && kind !== "contract";
  return (
    <header className="flex flex-wrap items-end justify-between gap-6">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[13px] text-subtle">
          <span>Address on Arc mainnet</span>
          {proxy && <><span>·</span><span>{kind === "eip1167Clone" ? "minimal clone" : "proxy"}</span></>}
        </div>
        <h1 className="num mt-2 break-all text-[20px] leading-snug text-fg sm:text-[26px]">{address}</h1>
        {implementation && (
          <p className="mt-2 text-[13px] text-muted">
            Code runs at <a className="num underline decoration-line-strong underline-offset-[3px] hover:text-fg" href={`/c/${implementation}`}>{implementation}</a>
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <a className="pressable inline-flex h-9 items-center rounded-lg px-3.5 text-[14px] font-medium text-muted hover:bg-elev-2 hover:text-fg"
          href={`https://explorer.arc.io/address/${address}`} target="_blank" rel="noreferrer">Explorer</a>
        {onRescan && <Button onClick={onRescan}>Scan again</Button>}
      </div>
    </header>
  );
}

function Verdict({ status }: { status: Status }) {
  const r = status.report!;
  const core = r.core;
  const n = (s: string) => core.findings.filter((f) => f.severity === s).length;
  const fns = plural(core.coverage.functionsAnalyzed, "function");
  const v = core.verdict;
  const title = v === "FINDINGS" ? "Mixes USDC's two views" : v === "CLEAN" ? "Keeps USDC's two views apart" : "Partly analyzed";
  const body = v === "FINDINGS"
    ? `${[n("HIGH") && `${n("HIGH")} high`, n("MEDIUM") && `${n("MEDIUM")} medium`, n("LOW") && `${n("LOW")} low`, n("INFO") && `${n("INFO")} info`].filter(Boolean).join(" · ")} across ${fns}. ${core.findings.length === 1 ? "It's" : "Each is"} shown below with the line, the unit trace and a fix.`
    : v === "CLEAN"
      ? `No rule fired across ${fns}. This covers mixing of the 6- and 18-decimal views of USDC, and nothing else.`
      : `${plural(core.coverage.unsupported.length, "function")} couldn't be followed. Everything that could be was checked across ${fns}.`;
  return (
    <section>
      <div className="flex flex-wrap items-center gap-3">
        <Pill tone={v} />
        <span className="num text-[12px] text-subtle">scanned {utc(r.scannedAt)}</span>
      </div>
      <h2 className={cn("mt-3 text-[30px] font-semibold leading-tight tracking-[-0.025em] sm:text-[36px]",
        v === "FINDINGS" ? "text-bad" : v === "CLEAN" ? "text-ok" : "text-v18")}>{title}</h2>
      <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-muted">{body}</p>
    </section>
  );
}

function Notice({ title, body, tone, action, footer, detail }: {
  title: string; body: string; tone: "neutral" | "warn" | "bad"; action?: React.ReactNode; footer?: React.ReactNode;
  detail?: string | undefined;
}) {
  return (
    <div className={cn("rounded-2xl border px-5 py-5",
      tone === "bad" ? "border-bad/30 bg-bad-soft/50" : tone === "warn" ? "border-v18/25 bg-v18-soft/40" : "border-line bg-elev")}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-[64ch]">
          <h2 className="text-[16px] font-semibold text-fg">{title}</h2>
          <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{body}</p>
          {detail && (
            <p className="mt-3 border-l-2 border-line-strong pl-3 text-[12.5px] leading-relaxed text-subtle">
              <span className="text-muted">Analyzer detail: </span>{detail}
            </p>
          )}
          {footer && <p className="mt-2 text-[13px] text-subtle">{footer}</p>}
        </div>
        {action}
      </div>
    </div>
  );
}
