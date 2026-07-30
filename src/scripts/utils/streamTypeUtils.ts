import type { Duplex } from "readable-stream";

type StreamLifecycle = Duplex & {
  setMaxListeners: (n: number) => unknown;
  removeAllListeners: (event?: string | symbol) => unknown;
  destroy: (error?: Error) => unknown;
};

/**
 * The stream-like objects actually passed to these helpers. Narrower than
 * `unknown` on purpose: these assertions exist to reconcile mismatched
 * `readable-stream` typings across the inpage/content/service-worker plumbing, and
 * accepting `unknown` meant `null` or an unrelated object type-checked happily —
 * turning a compile error into a runtime fault on the security-relevant messaging
 * path. `extensionStream` in particular is declared nullable.
 * See CIPH-QRLW326-35.
 */
type StreamLike = {
  on?: unknown;
  pipe?: unknown;
  write?: unknown;
  destroy?: unknown;
};

export const asDuplexStream = (stream: StreamLike): Duplex =>
  stream as unknown as Duplex;

export const asStreamLifecycle = (stream: StreamLike): StreamLifecycle =>
  stream as unknown as StreamLifecycle;
