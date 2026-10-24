import type { BridgeMethod, ErrorCode } from "@snapcrawl/shared";

export class BridgeFailure extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "BridgeFailure";
    this.code = code;
  }
}

export type Bridge = {
  port: number;
  request(method: BridgeMethod, params: unknown, timeoutMs: number): Promise<unknown>;
  isReady(): boolean;
  waitUntilReady(timeoutMs: number): Promise<void>;
  cancelCrawls(crawlId?: string): void;
  onCancel(listener: (crawlId?: string) => void): void;
  close(): Promise<void>;
};
