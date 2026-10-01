// Optional ops/alert channel: HIGH and OPS alerts only (MONITOR §6, ARCHITECTURE §5).
import type { Alert } from "../types.js";

export async function telegram(token: string, chatId: string, chainId: number, a: Alert): Promise<void> {
  if (a.severity !== "HIGH" && a.severity !== "OPS") return;
  const text = `[Twelve ${chainId === 5042 ? "mainnet" : "testnet"}] ${a.severity} ${a.detector}` +
    `${a.address ? ` ${a.address}` : ""}${a.tx ? `\ntx ${a.tx}` : ""}\n${JSON.stringify(a.evidence).slice(0, 600)}`;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}
