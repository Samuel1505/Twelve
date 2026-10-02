"use client";

import { Button } from "@/components/ui/button";

/** Last-resort boundary: a sentence and a way forward, never a blank page. */
export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto max-w-[640px] px-5 py-28 sm:px-8">
      <h1 className="text-[32px] font-semibold tracking-[-0.025em] text-fg">This page hit an error</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        Something on our side failed while rendering it. Nothing about any contract is implied by this. Try again, and if it
        keeps happening, the rest of the site still works.
      </p>
      <div className="mt-8"><Button variant="primary" onClick={() => retry()}>Try again</Button></div>
    </div>
  );
}
