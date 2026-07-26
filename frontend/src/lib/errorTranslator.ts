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
