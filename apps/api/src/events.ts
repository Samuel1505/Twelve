import { EventEmitter } from "node:events";

/** In-process fan-out of scan state changes to SSE clients (api and worker share one process, ARCHITECTURE §5). */
export type ScanEvent = { scanId: string; state: string; error?: unknown; reportHash?: string; attestTx?: string };

export class ScanBus {
  readonly #e = new EventEmitter().setMaxListeners(1000);
  publish(ev: ScanEvent): void {
    this.#e.emit(ev.scanId, ev);
  }
  subscribe(scanId: string, fn: (ev: ScanEvent) => void): () => void {
    this.#e.on(scanId, fn);
    return () => this.#e.off(scanId, fn);
  }
}
