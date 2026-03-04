import type { Response } from "express";

type MarketplaceStreamFilters = {
  wallet?: string;
  nftId?: number;
  auctionId?: number;
};

type MarketplaceStreamClient = {
  response: Response;
  filters: MarketplaceStreamFilters;
};

type MarketplaceEventPayload = {
  eventId: string;
  timestamp: number;
  type: string;
  data: Record<string, unknown>;
};

const clients = new Set<MarketplaceStreamClient>();

const normalizeWallet = (wallet: string): string => wallet.trim().toLowerCase();

const writeSseEvent = (res: Response, event: string, payload: unknown): void => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const matchesFilters = (filters: MarketplaceStreamFilters, payload: MarketplaceEventPayload): boolean => {
  if (filters.wallet) {
    const wallets = payload.data.wallets;
    if (!Array.isArray(wallets) || !wallets.includes(filters.wallet)) {
      return false;
    }
  }

  if (filters.nftId !== undefined) {
    const payloadNftId = payload.data.nftId;
    if (typeof payloadNftId !== "number" || payloadNftId !== filters.nftId) {
      return false;
    }
  }

  if (filters.auctionId !== undefined) {
    const payloadAuctionId = payload.data.auctionId;
    if (typeof payloadAuctionId !== "number" || payloadAuctionId !== filters.auctionId) {
      return false;
    }
  }

  return true;
};

export const subscribeMarketplaceStream = (
  response: Response,
  filters: MarketplaceStreamFilters,
): (() => void) => {
  const normalizedFilters: MarketplaceStreamFilters = {
    wallet: filters.wallet ? normalizeWallet(filters.wallet) : undefined,
    nftId: filters.nftId,
    auctionId: filters.auctionId,
  };

  const client: MarketplaceStreamClient = {
    response,
    filters: normalizedFilters,
  };

  clients.add(client);

  writeSseEvent(response, "connected", {
    timestamp: Date.now(),
    filters: normalizedFilters,
  });

  return () => {
    clients.delete(client);
  };
};

export const publishMarketplaceEvent = (
  type: string,
  data: Record<string, unknown>,
): void => {
  if (clients.size === 0) {
    return;
  }

  const payload: MarketplaceEventPayload = {
    eventId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timestamp: Date.now(),
    type,
    data,
  };

  for (const client of clients) {
    if (matchesFilters(client.filters, payload)) {
      writeSseEvent(client.response, "marketplace", payload);
    }
  }
};
