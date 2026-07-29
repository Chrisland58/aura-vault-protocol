export type ErrorCode =
  | "INVALID_WALLET_ADDRESS"
  | "INSUFFICIENT_BALANCE"
  | "TRANSACTION_FAILED"
  | "NETWORK_ERROR"
  | "RATE_LIMIT_EXCEEDED"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "TIMEOUT"
  | "SERVICE_UNAVAILABLE"
  | "REFRESH_TOKEN_EXPIRED"
  | "INVALID_TOKEN"
  | "UNKNOWN";

// ---------------------------------------------------------------------------
// Contextual error recovery types
// ---------------------------------------------------------------------------

export type RecoveryAction = {
  label: string;
  action: "retry" | "reduce_amount" | "start_over" | "external";
  href?: string;
};

export type VaultErrorContext = {
  title: string;
  message: string;
  /** lucide-react icon component name */
  icon: string;
  severity: "error" | "warning" | "info";
  actions: RecoveryAction[];
};

export interface ErrorRecoveryContext {
  enteredAmount?: string;
  walletBalance?: string;
  tokenSymbol?: string;
}

/**
 * Classify an unknown error thrown during vault transactions and return
 * structured, user-friendly recovery guidance.
 */
export function getErrorRecovery(
  error: unknown,
  context?: ErrorRecoveryContext
): VaultErrorContext {
  const msg = extractMessage(error).toLowerCase();
  const symbol = context?.tokenSymbol ?? "tokens";

  // -----------------------------------------------------------------------
  // 1. Insufficient balance
  // -----------------------------------------------------------------------
  if (
    isInsufficientBalance(error, msg)
  ) {
    const walletBal = context?.walletBalance ?? "unknown";
    const entered = context?.enteredAmount ?? "the entered amount";
    return {
      title: "Insufficient Balance",
      message: `Your wallet has ${walletBal} ${symbol} but you entered ${entered}. Reduce amount or top up wallet.`,
      icon: "Wallet",
      severity: "warning",
      actions: [
        { label: "Reduce Amount", action: "reduce_amount" },
      ],
    };
  }

  // -----------------------------------------------------------------------
  // 2. Vault paused (error code 11 / VaultPaused)
  // -----------------------------------------------------------------------
  if (isVaultPaused(error, msg)) {
    return {
      title: "Vault Is Paused",
      message: "The vault is paused. Check back later or follow @AuraVault for updates.",
      icon: "PauseCircle",
      severity: "warning",
      actions: [
        {
          label: "Follow @AuraVault",
          action: "external",
          href: "https://twitter.com/AuraVault",
        },
      ],
    };
  }

  // -----------------------------------------------------------------------
  // 3. Wrong network / network mismatch
  // -----------------------------------------------------------------------
  if (isWrongNetwork(msg)) {
    return {
      title: "Wrong Network",
      message: "Your wallet is connected to the wrong network. Switch to the correct network in Freighter and try again.",
      icon: "Globe",
      severity: "warning",
      actions: [
        {
          label: "Open Freighter",
          action: "external",
          href: "https://www.freighter.app/",
        },
      ],
    };
  }

  // -----------------------------------------------------------------------
  // 4. Network / connection error
  // -----------------------------------------------------------------------
  if (isNetworkError(error, msg)) {
    return {
      title: "Connection Issue",
      message: "Connection issue. Check your internet connection and try again.",
      icon: "WifiOff",
      severity: "error",
      actions: [
        { label: "Try Again", action: "retry" },
      ],
    };
  }

  // -----------------------------------------------------------------------
  // 5. Generic fallback
  // -----------------------------------------------------------------------
  const rawMessage = extractMessage(error) || "Transaction failed";
  return {
    title: "Transaction Failed",
    message: rawMessage,
    icon: "XCircle",
    severity: "error",
    actions: [
      { label: "Try Again", action: "retry" },
      { label: "Start Over", action: "start_over" },
    ],
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (
    error !== null &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as Record<string, unknown>).message === "string"
  ) {
    return (error as Record<string, unknown>).message as string;
  }
  return "";
}

function isInsufficientBalance(error: unknown, lowerMsg: string): boolean {
  if (
    lowerMsg.includes("insufficient balance") ||
    lowerMsg.includes("insufficient funds") ||
    lowerMsg.includes("insufficientbalance") ||
    lowerMsg.includes("not enough balance")
  ) {
    return true;
  }
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as Record<string, unknown>).code === "INSUFFICIENT_BALANCE"
  ) {
    return true;
  }
  return false;
}

function isVaultPaused(error: unknown, lowerMsg: string): boolean {
  if (
    lowerMsg.includes("vaultpaused") ||
    lowerMsg.includes("vault paused") ||
    lowerMsg.includes("paused")
  ) {
    return true;
  }
  // Soroban contract error code 11
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as Record<string, unknown>).code === 11
  ) {
    return true;
  }
  return false;
}

function isWrongNetwork(lowerMsg: string): boolean {
  return (
    lowerMsg.includes("wrong network") ||
    lowerMsg.includes("network mismatch")
  );
}

function isNetworkError(error: unknown, lowerMsg: string): boolean {
  if (error instanceof TypeError && lowerMsg.includes("fetch")) {
    return true;
  }
  if (lowerMsg.includes("network") || lowerMsg.includes("connection")) {
    return true;
  }
  return false;
}

const errorMessages: Record<ErrorCode, { title: string; message: string }> = {
  INVALID_WALLET_ADDRESS: {
    title: "Invalid Wallet Address",
    message: "The wallet address provided is not valid. Please check and try again.",
  },
  INSUFFICIENT_BALANCE: {
    title: "Insufficient Balance",
    message: "Your account doesn't have enough balance for this transaction.",
  },
  TRANSACTION_FAILED: {
    title: "Transaction Failed",
    message: "The transaction couldn't be completed. Please try again.",
  },
  NETWORK_ERROR: {
    title: "Connection Error",
    message: "Network connection error. Please check your internet and try again.",
  },
  RATE_LIMIT_EXCEEDED: {
    title: "Too Many Requests",
    message: "You're making requests too quickly. Please wait a moment and try again.",
  },
  UNAUTHORIZED: {
    title: "Permission Denied",
    message: "You don't have permission to perform this action.",
  },
  NOT_FOUND: {
    title: "Not Found",
    message: "The requested resource was not found.",
  },
  INVALID_INPUT: {
    title: "Invalid Information",
    message: "The information you provided is not valid. Please check and try again.",
  },
  TIMEOUT: {
    title: "Request Timeout",
    message: "The request took too long. Please try again.",
  },
  SERVICE_UNAVAILABLE: {
    title: "Service Unavailable",
    message: "The service is temporarily unavailable. Please try again later.",
  },
  REFRESH_TOKEN_EXPIRED: {
    title: "Session Expired",
    message: "Your session has expired. Please log in again.",
  },
  INVALID_TOKEN: {
    title: "Invalid Session",
    message: "Invalid authentication token. Please log in again.",
  },
  UNKNOWN: {
    title: "Error",
    message: "An unexpected error occurred. Please try again.",
  },
};

export function translateError(error: unknown): { title: string; message: string } {
  if (error instanceof Response) {
    if (error.status === 401) {
      return errorMessages.INVALID_TOKEN;
    }
    if (error.status === 403) {
      return errorMessages.UNAUTHORIZED;
    }
    if (error.status === 404) {
      return errorMessages.NOT_FOUND;
    }
    if (error.status === 429) {
      return errorMessages.RATE_LIMIT_EXCEEDED;
    }
    if (error.status >= 500) {
      return errorMessages.SERVICE_UNAVAILABLE;
    }
    if (error.status >= 400) {
      return errorMessages.INVALID_INPUT;
    }
  }

  if (error instanceof TypeError) {
    if (error.message.includes("fetch")) {
      return errorMessages.NETWORK_ERROR;
    }
  }

  if (error instanceof Error) {
    const errorWithCode = error as Error & { code?: string };
    const code = errorWithCode.code as ErrorCode | undefined;
    if (code && code in errorMessages) {
      return errorMessages[code];
    }
    return {
      title: "Error",
      message: error.message || "An unexpected error occurred.",
    };
  }

  return errorMessages.UNKNOWN;
}

export function createRetryableError(error: unknown): boolean {
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return true;
  }

  if (error instanceof Response) {
    return error.status >= 500 || error.status === 429;
  }

  return false;
}
