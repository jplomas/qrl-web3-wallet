import { JsonRpcMiddleware } from "@theqrl/qrl-wallet-provider/json-rpc-engine";
import { providerErrors } from "@theqrl/qrl-wallet-provider/rpc-errors";
import { Json, JsonRpcRequest } from "@theqrl/qrl-wallet-provider/utils";
import browser from "webextension-polyfill";
import { UNRESTRICTED_METHODS } from "../constants/requestConstants";
import { EXTENSION_MESSAGES } from "../constants/streamConstants";
import StorageUtil from "@/utilities/storageUtil";
import { getSerializableObject } from "../utils/scriptUtils";
import { checkDomain } from "../phishing/phishingDetector";
import {
  checkUrlOriginHasBeenConnected,
  getRequestOrigin,
} from "../utils/restrictedMethodsMiddlewareUtils";
import type { ExtendedSenderData } from "./appendSenderDataMiddleware";

const QRL_WALLET_DAPP_CONNECTION_REQUIRED_METHODS: string[] = [
  UNRESTRICTED_METHODS.QRL_ACCOUNTS,
];

/**
 * Unrestricted methods that a known-phishing origin must not reach.
 *
 * The phishing check used to run only on the restricted path, so a listed domain
 * could still enumerate the user's accounts and broadcast a pre-signed
 * transaction without any check at all. Those two are the unrestricted methods
 * with real consequence, so they are gated here. The remaining read-only chain
 * queries are left open deliberately — blocking them would break nothing for an
 * attacker and only degrades the wallet. See CIPH-QRLW326-27.
 */
const PHISHING_BLOCKED_UNRESTRICTED_METHODS: string[] = [
  UNRESTRICTED_METHODS.QRL_ACCOUNTS,
  UNRESTRICTED_METHODS.QRL_SEND_RAW_TRANSACTION,
];

// a precheck to determine if the request can proceed
const checkRequestCanProceed = async (req: JsonRpcRequest<JsonRpcRequest>) => {
  if (QRL_WALLET_DAPP_CONNECTION_REQUIRED_METHODS.includes(req.method)) {
    const originConnectResult = await checkUrlOriginHasBeenConnected(
      req?.senderData?.url ?? "",
    );
    if (!originConnectResult.canProceed) {
      return originConnectResult;
    }
  }
  return {
    canProceed: true,
    proceedError: providerErrors.unsupportedMethod(),
  };
};

/**
 * Methods answered here, in the service worker, rather than being forwarded to the
 * content script.
 *
 * These read and write the per-origin permission store. They used to execute in
 * the content script — a context injected into every frame of every URL, which is
 * the least-trusted place in the extension and has no need for storage access.
 * Answering them here keeps permission state inside the privileged context.
 * See CIPH-QRLW326-24.
 */
const handlePermissionMethodInServiceWorker = async (
  req: JsonRpcRequest<JsonRpcRequest>,
): Promise<{ handled: false } | { handled: true; result: Json }> => {
  const origin = getRequestOrigin(req?.senderData?.url);

  switch (req.method) {
    case UNRESTRICTED_METHODS.QRL_ACCOUNTS: {
      const data = await StorageUtil.getDAppsConnectedAccountsData(origin);
      return { handled: true, result: (data?.accounts ?? []) as Json };
    }
    case UNRESTRICTED_METHODS.WALLET_GET_PERMISSIONS: {
      const data = await StorageUtil.getDAppsConnectedAccountsData(origin);
      return {
        handled: true,
        result: getSerializableObject(data?.permissions ?? []) as Json,
      };
    }
    case UNRESTRICTED_METHODS.WALLET_REVOKE_PERMISSIONS: {
      // Revoking is a write. Refuse it for an unidentifiable origin rather than
      // clearing the shared opaque-origin bucket. See CIPH-QRLW326-31.
      if (origin) {
        await StorageUtil.clearDAppsConnectedAccountsData(origin);
      }
      return { handled: true, result: null };
    }
    default:
      return { handled: false };
  }
};

const getUnrestrictedMethodResult = async (
  req: JsonRpcRequest<JsonRpcRequest>,
) => {
  const tabId = req?.senderData?.tabId ?? 0;
  // `senderData` is typed by the provider library without our added fields; the
  // value is stamped by appendSenderDataMiddleware.
  const { frameId } = (req?.senderData ?? {}) as ExtendedSenderData;
  // Address the reply to the frame that asked. Without `frameId` the message goes
  // to *every* frame in the tab and each one independently performs the upstream
  // RPC, so a page with N iframes amplified one provider call into N requests
  // against the user's node — and executed side-effecting methods
  // (`qrl_sendRawTransaction`, `qrl_subscribe`) N times. See CIPH-QRLW326-21.
  return await browser.tabs.sendMessage(
    tabId,
    {
      name: EXTENSION_MESSAGES.UNRESTRICTED_METHOD_CALLS,
      data: req,
    },
    typeof frameId === "number" ? { frameId } : undefined,
  );
};

type UnrestrictedMethodValue =
  (typeof UNRESTRICTED_METHODS)[keyof typeof UNRESTRICTED_METHODS];

export const unrestrictedMethodsMiddleware: JsonRpcMiddleware<
  JsonRpcRequest,
  Json
> = async (req, res, next, end) => {
  const requestedMethod = req.method;
  if (
    Object.values(UNRESTRICTED_METHODS).includes(
      requestedMethod as UnrestrictedMethodValue,
    )
  ) {
    // Refuse the consequential unrestricted methods for a known-phishing origin.
    // See CIPH-QRLW326-27.
    if (PHISHING_BLOCKED_UNRESTRICTED_METHODS.includes(requestedMethod)) {
      const settings = await StorageUtil.getSettings();
      if (settings.phishingDetectionEnabled !== false) {
        const senderData = req.senderData as ExtendedSenderData | undefined;
        const isPhishing =
          checkDomain(senderData?.url ?? "").isDomainPhishing ||
          (senderData?.mainFrameOrigin
            ? checkDomain(senderData.mainFrameOrigin).isDomainPhishing
            : false);
        if (isPhishing) {
          res.error = providerErrors.unauthorized({
            message:
              "The wallet has blocked this request because the site is flagged as phishing.",
          });
          return end();
        }
      }
    }

    // check if the request can proceed
    const { canProceed, proceedError } = await checkRequestCanProceed(req);
    if (!canProceed) {
      // @ts-expect-error - proceedError type from provider library is not assignable to res.error's narrow type
      res.error = proceedError;
      return end();
    }

    try {
      const permissionResult = await handlePermissionMethodInServiceWorker(req);
      if (permissionResult.handled) {
        res.result = permissionResult.result;
        return end();
      }
      res.result = await getUnrestrictedMethodResult(req);
    } catch (error: unknown) {
      res.error = providerErrors.unsupportedMethod({
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return end();
  } else {
    next();
  }
};
