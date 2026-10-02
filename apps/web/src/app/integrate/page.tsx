import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/site/page-header";
import { Hash } from "@/components/ui/address";
import { CodeBlock } from "@/components/ui/code-block";
import { Pill, type PillTone } from "@/components/ui/unit-chip";
import { API_URL, MAINNET } from "@/lib/config";

export const metadata: Metadata = { title: "Integrate · Twelve" };

const SECTIONS = [
  { id: "check", title: "Check before you send" },
  { id: "gate", title: "Route through TwelveGate" },
  { id: "statuses", title: "What each status means" },
  { id: "offchain", title: "Read it off-chain" },
  { id: "webhooks", title: "Get alerts for your contract" },
  { id: "ci", title: "Scan in CI" },
] as const;

const STATUSES: { s: PillTone; clean: boolean; text: string }[] = [
  { s: "CLEAN", clean: true, text: "Scanned, no findings, and the code at the address is still the code that was scanned." },
  { s: "FINDINGS", clean: false, text: "At least one finding. The report says which line and how to fix it." },
  { s: "INCOMPLETE", clean: false, text: "Some functions couldn't be followed (for example assembly on a value path). Treat as unknown." },
  { s: "STALE", clean: false, text: "The code changed after the attestation. The old verdict says nothing about the new code." },
  { s: "REVOKED", clean: false, text: "The attester withdrew it, for example after a proxy upgrade. A rescan follows." },
  { s: "NONE", clean: false, text: "Never attested by this attester." },
];

export default function IntegratePage() {
  return (
    <div className="mx-auto max-w-[1120px] px-5 pb-24 pt-12 sm:px-8 sm:pt-16">
      <PageHeader
        eyebrow="For builders on Arc"
        title="Integrate"
        lead={<>The registry is a plain contract with no owner and no admin. Pick the attester you trust, read its verdict
          for the code a target has right now, and refuse native USDC when it isn&apos;t clean.</>}
      />

      <div className="mt-14 grid gap-12 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-16">
        <nav aria-label="On this page" className="hidden lg:block">
          <ol className="sticky top-24 space-y-2.5 text-[13px]">
            {SECTIONS.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="flex gap-2.5 text-muted transition-colors hover:text-fg">
                  <span className="num text-subtle">{String(i + 1).padStart(2, "0")}</span>{s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0 space-y-20">
          <dl className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line text-[13px] sm:grid-cols-2">
            <Addr k="TwelveRegistry" v={MAINNET.registry} />
            <Addr k="Twelve attester" v={MAINNET.attester} />
            <Addr k="TwelveGate" v={MAINNET.gate} />
            <div className="bg-bg px-5 py-4">
              <dt className="text-subtle">Network</dt>
              <dd className="num mt-1 text-fg">Arc mainnet · chain {MAINNET.chainId}</dd>
            </div>
          </dl>

          <Section id="check" n={1} title="Check before you send" lead={<>
            One call. <span className="num text-fg">isClean</span> is true only when the attester&apos;s verdict is CLEAN
            <em className="not-italic text-fg"> and</em> the target&apos;s codehash still equals the one that was scanned, so a
            redeployed or upgraded contract is never waved through on an old report.</>}>
            <CodeBlock title="YourRouter.sol" code={`import {ITwelveRegistry} from "twelve/interfaces/ITwelveRegistry.sol";

ITwelveRegistry constant REGISTRY = ITwelveRegistry(${MAINNET.registry});
address constant ATTESTER = ${MAINNET.attester};

error TargetNotClean(address target, ITwelveRegistry.Status status);

function _pay(address target, bytes calldata data) internal {
    if (!REGISTRY.isClean(ATTESTER, target)) {
        revert TargetNotClean(target, REGISTRY.status(ATTESTER, target));
    }
    (bool ok,) = target.call{value: msg.value}(data);
    require(ok);
}`} />
          </Section>

          <Section id="gate" n={2} title="Route through TwelveGate" lead={<>
            If you&apos;d rather not change your contracts, send through the deployed gate. It forwards
            <span className="num text-fg"> msg.value</span> and calldata only to CLEAN targets and bubbles up their reverts
            unchanged. Anything else reverts with <span className="num text-fg">TargetNotClean(target, status)</span>,
            selector <span className="num text-fg">0x288c31a8</span>.</>}>
            <CodeBlock title="Forward 5 USDC natively" code={`// native view: 5 USDC = 5 * 10^18 base units
TwelveGate gate = TwelveGate(${MAINNET.gate});
gate.forward{value: 5 ether}(target, abi.encodeCall(Shop.buy, (1)));`} />
            <p className="text-[13px] leading-relaxed text-muted">
              <span className="num text-fg">5 ether</span> is Solidity&apos;s spelling of 5 × 10¹⁸, which on Arc is 5 USDC in the
              native view. The same 5 USDC through the ERC-20 is <span className="num text-v6">5000000</span>.
            </p>
          </Section>

          <Section id="statuses" n={3} title="What each status means" lead="status(attester, target) returns one of six values. Only CLEAN passes isClean.">
            <div className="overflow-hidden rounded-2xl border border-line">
              <ul className="divide-y divide-line">
                {STATUSES.map((x) => (
                  <li key={x.s} className="grid gap-2 px-5 py-3.5 sm:grid-cols-[120px_minmax(0,1fr)_auto] sm:items-center">
                    <span><Pill tone={x.s} /></span>
                    <span className="text-[13.5px] leading-relaxed text-muted">{x.text}</span>
                    <span className={x.clean ? "num whitespace-nowrap text-[12px] text-ok sm:text-right" : "num whitespace-nowrap text-[12px] text-subtle sm:text-right"}>
                      isClean {x.clean ? "true" : "false"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Section>

          <Section id="offchain" n={4} title="Read it off-chain" lead="Wallets and frontends can warn before a user signs. Read the registry directly, or ask the API for the verdict, the report and recent alerts in one response.">
            <CodeBlock lang="sh" lineNumbers={false} title="HTTP" code={`curl ${API_URL}/v1/status/${MAINNET.leakyRefund}?chainId=${MAINNET.chainId}`} />
            <CodeBlock title="viem" lineNumbers={false} code={`const clean = await client.readContract({
  address: "${MAINNET.registry}",
  abi: parseAbi(["function isClean(address attester, address target) view returns (bool)"]),
  functionName: "isClean",
  args: ["${MAINNET.attester}", target],
});`} />
          </Section>

          <Section id="webhooks" n={5} title="Get alerts for your contract" lead={<>
            Subscribe a URL to an address. Each alert is POSTed as JSON with
            <span className="num text-fg"> x-twelve-signature</span>, the hex HMAC-SHA256 of the raw body under the secret you
            get back once. Failed deliveries retry five times with backoff.</>}>
            <CodeBlock lang="sh" lineNumbers={false} title="Subscribe" code={`curl -X POST ${API_URL}/v1/subscriptions \\
  -H 'content-type: application/json' \\
  -d '{"address":"0xYourContract","webhookUrl":"https://example.com/twelve"}'
# → {"id":"…","secret":"…"}   the secret is shown once`} />
            <CodeBlock title="Verify a delivery (Node)" lineNumbers={false} code={`import { createHmac, timingSafeEqual } from "node:crypto";

const expected = createHmac("sha256", secret).update(rawBody).digest();
const given = Buffer.from(req.headers["x-twelve-signature"], "hex");
const ok = given.length === expected.length && timingSafeEqual(given, expected);`} />
          </Section>

          <Section id="ci" n={6} title="Scan in CI" lead="Run the analyzer on your sources before deploy. It exits non-zero when a finding meets the threshold, so the build stops at the line that would have shipped.">
            <CodeBlock lang="sh" lineNumbers={false} title="From a checkout of Twelve" code={`uv run --project analyzer twelve scan path/to/contracts --fail-on HIGH`} />
            <p className="text-[13px] leading-relaxed text-muted">
              Typed amounts that make mixing the two views a compile error (<span className="num text-fg">Usdc6</span>,
              <span className="num text-fg"> Usdc18</span>) ship in the next release.
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Addr({ k, v }: { k: string; v: string }) {
  return (
    <div className="bg-bg px-5 py-4">
      <dt className="text-subtle">{k}</dt>
      <dd className="mt-1"><Hash value={v} head={10} tail={8} /></dd>
    </div>
  );
}

function Section({ id, n, title, lead, children }: { id: string; n: number; title: string; lead: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-5">
      <div>
        <div className="num text-[12px] text-subtle">{String(n).padStart(2, "0")}</div>
        <h2 className="mt-1.5 text-[22px] font-semibold tracking-[-0.02em] text-fg">{title}</h2>
        <p className="mt-2.5 max-w-[66ch] text-[14.5px] leading-[1.7] text-muted">{lead}</p>
      </div>
      {children}
    </section>
  );
}
