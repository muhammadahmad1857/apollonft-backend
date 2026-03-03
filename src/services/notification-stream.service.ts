import type { Response } from "express";

const walletStreams = new Map<string, Set<Response>>();

const writeSseEvent = (res: Response, event: string, payload: unknown): void => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const normalizeWalletAddress = (walletAddress: string): string => walletAddress.trim().toLowerCase();

export const subscribeNotificationStream = (walletAddress: string, res: Response): (() => void) => {
  const normalizedWallet = normalizeWalletAddress(walletAddress);
  const existing = walletStreams.get(normalizedWallet) ?? new Set<Response>();
  existing.add(res);
  walletStreams.set(normalizedWallet, existing);

  writeSseEvent(res, "connected", { walletAddress: normalizedWallet });

  return () => {
    const streamSet = walletStreams.get(normalizedWallet);
    if (!streamSet) {
      return;
    }

    streamSet.delete(res);
    if (streamSet.size === 0) {
      walletStreams.delete(normalizedWallet);
    }
  };
};

export const publishNotificationToWallet = (walletAddress: string, payload: unknown): void => {
  const normalizedWallet = normalizeWalletAddress(walletAddress);
  const streamSet = walletStreams.get(normalizedWallet);

  if (!streamSet || streamSet.size === 0) {
    return;
  }

  for (const response of streamSet) {
    writeSseEvent(response, "notification", payload);
  }
};
