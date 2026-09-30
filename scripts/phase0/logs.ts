// Facts (ARC_LEDGER §2, §7):
//  - an ERC-20 transfer() on 0x3600 emits exactly two Transfer logs: 6-dec from 0x3600, 18-dec from 0xff..fe,
//    with v18 == v6 * SCALE; record their order within the tx.
//  - a native send emits exactly one system log and zero 0x3600 logs.
//  - gas deduction emits no Transfer log.
// Usage: tsx logs.ts [--net testnet] [--window 2000]
import { decodeEventLog, getAddress, parseAbiItem, type Hash, type Log, type PublicClient, type TransactionReceipt } from "viem";
import { SYSTEM_EMITTER, TRANSFER_TOPIC, USDC_ERC20, USDC_SCALE } from "@twelve/shared";
import { client, dump, finish, info, netArg, report } from "./lib.ts";

const net = netArg();
const c = client(net);
const wIdx = process.argv.indexOf("--window");
const WINDOW = BigInt(wIdx >= 0 ? process.argv[wIdx + 1] ?? "2000" : "2000");
const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const TRANSFER_SELECTOR = "0xa9059cbb";

const sys = (l: Log) => getAddress(l.address) === getAddress(SYSTEM_EMITTER) && l.topics[0] === TRANSFER_TOPIC;
const erc = (l: Log) => getAddress(l.address) === getAddress(USDC_ERC20) && l.topics[0] === TRANSFER_TOPIC;
const decode = (l: Log) => decodeEventLog({ abi: [transferEvent], data: l.data, topics: l.topics as [Hash, ...Hash[]] }).args;

const head = await c.getBlockNumber();
info(`${net} head`, `block ${head}`);

// Walk back from head in chunks until we find the candidates we need.
async function findTx(pred: (tx: { to: string | null; input: string; value: bigint }) => boolean, label: string): Promise<Hash | null> {
  for (let b = head; b > head - WINDOW && b >= 0n; b--) {
    const blk = await c.getBlock({ blockNumber: b, includeTransactions: true });
    for (const tx of blk.transactions) if (pred(tx)) return tx.hash;
  }
  info(`${label} search`, `no candidate in last ${WINDOW} blocks (raise --window)`);
  return null;
}

async function receipt(h: Hash, name: string): Promise<TransactionReceipt> {
  const r = await c.getTransactionReceipt({ hash: h });
  info(`${name} evidence`, `tx ${h} block ${r.blockNumber} status ${r.status} → ${dump(`${net}-${name}.json`, r)}`);
  return r;
}

// 1. ERC-20 transfer(): direct call to 0x3600 with transfer selector.
const ercTx = await findTx((tx) => tx.to !== null && getAddress(tx.to) === getAddress(USDC_ERC20) && tx.input.startsWith(TRANSFER_SELECTOR), "erc20-transfer");
if (ercTx) {
  const r = await receipt(ercTx, "erc20-transfer");
  const s = r.logs.filter(sys), e = r.logs.filter(erc);
  report(r.logs.length === 2 && s.length === 1 && e.length === 1, "ERC-20 transfer emits exactly 2 Transfer logs (1× 0x3600, 1× 0xff..fe)",
    `total=${r.logs.length} system=${s.length} erc20=${e.length} tx=${ercTx}`);
  if (s[0] && e[0]) {
    const a = decode(s[0]), b = decode(e[0]);
    report(a.value === b.value * USDC_SCALE, "v18 == v6 * 10^12", `v18=${a.value} v6=${b.value}`);
    report(a.from === b.from && a.to === b.to, "system and ERC-20 logs share (from, to)", `sys=${a.from}→${a.to} erc=${b.from}→${b.to}`);
    const order = s[0].logIndex! < e[0].logIndex! ? "system BEFORE erc20" : "erc20 BEFORE system";
    info("log ordering within ERC-20 transfer tx", `${order} (system logIndex=${s[0].logIndex}, erc20 logIndex=${e[0].logIndex}, adjacent=${Math.abs(s[0].logIndex! - e[0].logIndex!) === 1})`);
  }
}

// 2. Native send: value > 0, empty calldata, to an EOA.
async function isEoa(c: PublicClient, a: string) { const code = await c.getCode({ address: getAddress(a) }); return !code || code === "0x"; }
let nativeTx: Hash | null = null;
for (let b = head; b > head - WINDOW && b >= 0n && !nativeTx; b--) {
  const blk = await c.getBlock({ blockNumber: b, includeTransactions: true });
  for (const tx of blk.transactions) {
    if (tx.to && tx.value > 0n && tx.input === "0x" && (await isEoa(c, tx.to))) { nativeTx = tx.hash; break; }
  }
}
if (!nativeTx) info("native-send search", `no candidate in last ${WINDOW} blocks (raise --window)`);
if (nativeTx) {
  const r = await receipt(nativeTx, "native-send");
  const tx = await c.getTransaction({ hash: nativeTx });
  const s = r.logs.filter(sys), e = r.logs.filter(erc);
  report(s.length === 1 && e.length === 0, "native send emits exactly 1 system log, 0 ERC-20 logs",
    `total=${r.logs.length} system=${s.length} erc20=${e.length} tx=${nativeTx}`);
  if (s[0]) {
    const a = decode(s[0]);
    report(a.value === tx.value && getAddress(a.from) === getAddress(tx.from) && a.to !== undefined && getAddress(a.to) === getAddress(tx.to!),
      "system log (from,to,value) == (tx.from, tx.to, tx.value)", `log=${a.from}→${a.to} ${a.value}; tx value=${tx.value}`);
  }
  // 3. Gas: this tx paid gasUsed*effectiveGasPrice > 0; if gas were logged there would be a second system log.
  const fee = r.gasUsed * r.effectiveGasPrice;
  report(fee > 0n && s.length === 1, "gas deduction emits no Transfer log (native send)", `fee18=${fee} system logs=${s.length}`);
}

// 3b. Gas on a tx that moves no USDC: any successful tx with zero system logs and fee > 0 proves gas is unlogged.
let gasOnly: Hash | null = null;
for (let b = head; b > head - WINDOW && b >= 0n && !gasOnly; b--) {
  const blk = await c.getBlock({ blockNumber: b, includeTransactions: true });
  for (const tx of blk.transactions) {
    if (tx.value !== 0n || tx.to === null) continue;
    const r = await c.getTransactionReceipt({ hash: tx.hash });
    if (r.status === "success" && r.logs.filter(sys).length === 0) { gasOnly = tx.hash; break; }
  }
}
if (gasOnly) {
  const r = await receipt(gasOnly, "gas-only");
  report(r.gasUsed * r.effectiveGasPrice > 0n && r.logs.filter(sys).length === 0,
    "gas deduction emits no Transfer log (zero-value tx)", `tx=${gasOnly} fee18=${r.gasUsed * r.effectiveGasPrice} logs=${r.logs.length}`);
} else info("gas-only search", `no zero-value tx without system logs in last ${WINDOW} blocks`);

finish();
