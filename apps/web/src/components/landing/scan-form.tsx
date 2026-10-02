"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { MAINNET } from "@/lib/config";
import { cn } from "@/lib/cn";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function ScanForm({ autoFocus = false, size = "lg" }: { autoFocus?: boolean; size?: "lg" | "md" }) {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState<string>(MAINNET.leakyRefund);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const v = value.trim();
        if (!ADDRESS.test(v)) {
          setError("That isn't a contract address. It should be 0x followed by 40 hex characters.");
          return;
        }
        setPending(true);
        router.push(`/c/${v}`);
      }}
      className="w-full"
    >
      <label htmlFor={id} className="sr-only">Contract address on Arc mainnet</label>
      <div
        className={cn(
          "flex items-center gap-2 rounded-xl border bg-elev p-1.5 pl-4 transition-[border-color,box-shadow] duration-150",
          error ? "border-bad/60" : "border-line-strong focus-within:border-fg/30 focus-within:shadow-[0_0_0_4px_var(--line)]",
        )}
      >
        <input
          id={id}
          value={value}
          autoFocus={autoFocus}
          spellCheck={false}
          autoComplete="off"
          inputMode="text"
          placeholder="0x… a verified contract on Arc mainnet"
          aria-invalid={Boolean(error)}
          aria-describedby={`${id}-hint`}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          className={cn("num min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-subtle",
            size === "lg" ? "h-10 text-[14px] sm:text-[15px]" : "h-8 text-[13px]")}
        />
        <button
          type="submit"
          disabled={pending}
          className={cn("pressable shrink-0 rounded-lg bg-fg px-4 font-medium text-bg hover:bg-fg/90 disabled:opacity-60",
            size === "lg" ? "h-10 text-[14px]" : "h-8 text-[13px]")}
        >
          {pending ? "Opening…" : "Scan"}
        </button>
      </div>
      <p id={`${id}-hint`} className={cn("mt-2.5 text-[13px]", error ? "text-bad" : "text-subtle")}>
        {error ?? <>Pre-filled with <span className="text-muted">LeakyRefund</span>, a deliberately broken shop live on mainnet. Paste any verified Arc contract.</>}
      </p>
    </form>
  );
}
