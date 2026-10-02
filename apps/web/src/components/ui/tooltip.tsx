"use client";

import { Tooltip as T } from "@base-ui-components/react/tooltip";
import type { ReactElement, ReactNode } from "react";

/** Wrap a group of tooltips: after the first opens (with delay), neighbours open instantly (Emil: skip delay). */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <T.Provider delay={350} closeDelay={0}>{children}</T.Provider>;
}

export function Tooltip({ content, children }: { content: ReactNode; children: ReactElement<Record<string, unknown>> }) {
  return (
    <T.Root>
      <T.Trigger render={children} />
      <T.Portal>
        <T.Positioner sideOffset={6}>
          <T.Popup
            className="origin-[var(--transform-origin)] rounded-md border border-line-strong bg-elev-2 px-2 py-1 text-[12px] text-fg shadow-lg shadow-black/30
              transition-[opacity,transform] duration-[125ms] ease-out
              data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0
              data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0
              data-[instant]:duration-0"
          >
            {content}
          </T.Popup>
        </T.Positioner>
      </T.Portal>
    </T.Root>
  );
}
