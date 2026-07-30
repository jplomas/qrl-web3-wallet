import { JsonRpcMiddleware } from "@theqrl/qrl-wallet-provider/json-rpc-engine";
import { rpcErrors } from "@theqrl/qrl-wallet-provider/rpc-errors";
import { Json, JsonRpcRequest } from "@theqrl/qrl-wallet-provider/utils";

/**
 * Guarantee that a middleware always settles the request it was given.
 *
 * The vendored `JsonRpcEngine` wraps middleware invocation in a *synchronous*
 * `try`/`catch`, which does not capture a rejection from an `async` middleware.
 * The wallet's middlewares are async and perform storage reads and network calls,
 * so an unexpected rejection — a malformed parameter reaching a destructure, a
 * storage failure — escaped the engine entirely: the caller's promise stayed
 * pending forever and the service worker logged an unhandled rejection. Repeated
 * at volume that accumulates unsettled requests and can get the worker killed,
 * degrading the wallet for every origin in the session.
 *
 * Wrapping here rather than adding a `try`/`catch` inside each middleware means a
 * middleware added later inherits the guarantee. See CIPH-QRLW326-30.
 */
export const withMiddlewareErrorBoundary = (
  middleware: JsonRpcMiddleware<JsonRpcRequest, Json>,
  name: string,
): JsonRpcMiddleware<JsonRpcRequest, Json> => {
  return async (req, res, next, end) => {
    try {
      return await middleware(req, res, next, end);
    } catch (error) {
      console.error(
        `QrlWeb3Wallet: unhandled error in ${name}; failing the request closed`,
        error,
      );
      // A middleware that wrote a result and *then* threw would otherwise
      // settle carrying both `result` and `error`. JSON-RPC 2.0 forbids that,
      // and a client reading `result` first would treat a failed request as a
      // successful one — the opposite of failing closed.
      delete res.result;
      res.error = rpcErrors.internal({
        message: "The wallet could not process the request.",
      });
      return end();
    }
  };
};
