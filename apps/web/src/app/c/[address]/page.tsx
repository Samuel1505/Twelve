import type { Metadata } from "next";
import { ContractView } from "@/components/contract/contract-view";
import { ScanForm } from "@/components/landing/scan-form";
import { getStatus } from "@/lib/api";
import { shortHash } from "@/lib/format";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export async function generateMetadata(props: PageProps<"/c/[address]">): Promise<Metadata> {
  const { address } = await props.params;
  return { title: ADDRESS.test(address) ? `${shortHash(address)} · Twelve` : "Not an address · Twelve" };
}

export default async function ContractPage(props: PageProps<"/c/[address]">) {
  const { address } = await props.params;
  if (!ADDRESS.test(address)) {
    return (
      <div className="mx-auto max-w-[640px] px-5 py-24 sm:px-8">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-fg">That isn&apos;t a contract address</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          <span className="num break-all text-fg">{address.slice(0, 80)}</span> should be <span className="num">0x</span>{" "}
          followed by 40 hexadecimal characters. Paste the address from the explorer or your wallet.
        </p>
        <div className="mt-8"><ScanForm size="md" /></div>
      </div>
    );
  }
  const initial = await getStatus(address);
  return <ContractView address={address} initial={initial} />;
}
