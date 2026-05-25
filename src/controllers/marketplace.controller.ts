import type { Request, Response } from "express";
import { NftModerationStatus } from "../generated/prisma/enums";
import { HttpError } from "../lib/http-error";
import { prisma } from "../lib/prisma";
import { logActivity } from "../services/activity-log.service";
import {
  publishMarketplaceEvent,
  subscribeMarketplaceStream,
} from "../services/marketplace-stream.service";

const SUPPORT_EMAIL = "hello@blaqclouds.io";

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected error";
};

const toBoolean = (value: unknown): boolean => value === "true" || value === true;

const toNumber = (value: unknown): number => Number(value);

const getIpAddress = (req: Request): string | null => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0]?.trim() ?? null;
  }
  return req.ip ?? null;
};

const resolveActorUserId = (req: Request, fallbacks: Array<number | undefined>): number | null => {
  if (req.authUser?.userId) {
    return req.authUser.userId;
  }

  for (const candidate of fallbacks) {
    if (typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0) {
      return candidate;
    }
  }

  return null;
};

const logMarketplaceActivity = async (
  req: Request,
  action: string,
  metadata: Record<string, unknown>,
  actorFallbacks: Array<number | undefined> = [],
): Promise<void> => {
  const actorUserId = resolveActorUserId(req, actorFallbacks);
  if (!actorUserId) {
    return;
  }

  try {
    await logActivity({
      userId: actorUserId,
      action,
      metadata,
      ipAddress: getIpAddress(req),
    });
  } catch (error) {
    console.error("Failed to log marketplace activity", error);
  }
};

const isTradeBlockedByModeration = (status: NftModerationStatus): boolean => {
  return status === NftModerationStatus.DELISTED || status === NftModerationStatus.HIDDEN;
};

const ensureUserNotBlockedById = async (userId: number): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isBlocked: true },
  });

  if (user?.isBlocked) {
    throw new HttpError(
      403,
      `Your account is blocked. Contact us at ${SUPPORT_EMAIL} if this is a mistake.`,
      "USER_BLOCKED",
    );
  }
};

const ensureNftTradableByTokenId = async (tokenId: number): Promise<void> => {
  const nft = await prisma.nFT.findUnique({
    where: { tokenId },
    select: { moderationStatus: true },
  });

  if (!nft) {
    throw new HttpError(404, "NFT not found", "NFT_NOT_FOUND");
  }

  if (isTradeBlockedByModeration(nft.moderationStatus)) {
    throw new HttpError(409, "This NFT is moderated and cannot be used for this action.", "NFT_MODERATED");
  }
};

const emitMarketplaceEvent = (type: string, data: Record<string, unknown>): void => {
  publishMarketplaceEvent(type, data);
};

const extractAuctionIds = (body: Record<string, unknown>): { sellerId: number; nftId: number } => {
  const seller = body.seller as { connect?: { id?: unknown } } | undefined;
  const nft = body.nft as { connect?: { id?: unknown } } | undefined;

  const sellerId = Number(seller?.connect?.id);
  const nftId = Number(nft?.connect?.id);

  if (!Number.isInteger(sellerId) || sellerId <= 0) {
    throw new HttpError(400, "Seller ID is required", "VALIDATION_ERROR");
  }

  if (!Number.isInteger(nftId) || nftId <= 0) {
    throw new HttpError(400, "NFT ID is required", "VALIDATION_ERROR");
  }

  return { sellerId, nftId };
};

const extractBidIds = (body: Record<string, unknown>): { auctionId: number; bidderId: number } => {
  const bidder = body.bidder as { connect?: { id?: unknown } } | undefined;
  const auction = body.auction as { connect?: { id?: unknown } } | undefined;

  const bidderId = Number(bidder?.connect?.id);
  const auctionId = Number(auction?.connect?.id);

  if (!Number.isInteger(auctionId) || auctionId <= 0) {
    throw new HttpError(400, "Auction ID must be provided to create a bid", "VALIDATION_ERROR");
  }

  if (!Number.isInteger(bidderId) || bidderId <= 0) {
    throw new HttpError(400, "Bidder ID must be provided to create a bid", "VALIDATION_ERROR");
  }

  return { auctionId, bidderId };
};

export const streamMarketplaceController = async (req: Request, res: Response): Promise<void> => {
  const wallet = typeof req.query.wallet === "string" ? req.query.wallet : undefined;
  const nftId = typeof req.query.nftId === "string" ? Number(req.query.nftId) : undefined;
  const auctionId = typeof req.query.auctionId === "string" ? Number(req.query.auctionId) : undefined;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    res.write("event: ping\n");
    res.write(`data: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
  }, 25000);

  const unsubscribe = subscribeMarketplaceStream(res, {
    wallet,
    nftId: Number.isInteger(nftId) ? nftId : undefined,
    auctionId: Number.isInteger(auctionId) ? auctionId : undefined,
  });

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
};

export const createNftController = async (req: Request, res: Response): Promise<void> => {
  const created = await prisma.nFT.create({ data: req.body });
  const owner = await prisma.user.findUnique({ where: { id: created.ownerId }, select: { walletAddress: true } });

  await logMarketplaceActivity(
    req,
    "MARKETPLACE_NFT_CREATED",
    {
      nftId: created.id,
      tokenId: created.tokenId,
      ownerId: created.ownerId,
      creatorId: created.creatorId,
    },
    [created.ownerId, created.creatorId],
  );

  emitMarketplaceEvent("marketplace.nft.created", {
    nftId: created.id,
    tokenId: created.tokenId,
    ownerId: created.ownerId,
    wallets: owner ? [owner.walletAddress.toLowerCase()] : [],
  });

  res.status(201).json({ success: true, message: "NFT created", data: created });
};

export const getNftByIdController = async (req: Request, res: Response): Promise<void> => {
  const id = toNumber(req.params.id);
  const nft = await prisma.nFT.findFirst({
    where: {
      id,
      moderationStatus: { not: NftModerationStatus.HIDDEN },
    },
  });

  res.status(200).json({ success: true, message: "NFT fetched", data: nft });
};

export const listNftsController = async (req: Request, res: Response): Promise<void> => {
  const likes = toBoolean(req.query.likes);
  const items = await prisma.nFT.findMany({
    where: {
      isListed: true,
      moderationStatus: { in: [NftModerationStatus.ACTIVE, NftModerationStatus.FLAGGED] },
    },
    orderBy: { createdAt: "desc" },
    include: {
      owner: true,
      auction: true,
      likes,
    },
  });

  res.status(200).json({ success: true, message: "NFTs fetched", data: items });
};

export const getNftByTokenIdController = async (req: Request, res: Response): Promise<void> => {
  const tokenId = toNumber(req.params.tokenId);
  const nft = await prisma.nFT.findFirst({
    where: {
      tokenId,
      moderationStatus: { not: NftModerationStatus.HIDDEN },
    },
    include: { owner: true },
  });
  res.status(200).json({ success: true, message: "NFT fetched", data: nft });
};

export const getVisibleNftByTokenIdController = async (req: Request, res: Response): Promise<void> => {
  const tokenId = toNumber(req.params.tokenId);
  const nft = await prisma.nFT.findFirst({
    where: {
      tokenId,
      moderationStatus: { in: [NftModerationStatus.ACTIVE, NftModerationStatus.FLAGGED] },
    },
    include: { owner: true },
  });
  res.status(200).json({ success: true, message: "Visible NFT fetched", data: nft });
};

export const getNftsByCreatorController = async (req: Request, res: Response): Promise<void> => {
  const creatorId = toNumber(req.params.creatorId);
  const items = await prisma.nFT.findMany({
    where: { creatorId },
    orderBy: { createdAt: "desc" },
  });
  res.status(200).json({ success: true, message: "Creator NFTs fetched", data: items });
};

export const getNftsByOwnerController = async (req: Request, res: Response): Promise<void> => {
  const ownerId = toNumber(req.params.ownerId);
  const needLike = toBoolean(req.query.needLike);
  const needAuction = toBoolean(req.query.needAuction);
  const needOwner = toBoolean(req.query.needOwner);

  const items = await prisma.nFT.findMany({
    where: {
      ownerId,
      moderationStatus: {
        in: [NftModerationStatus.ACTIVE, NftModerationStatus.FLAGGED, NftModerationStatus.DELISTED],
      },
    },
    orderBy: { createdAt: "desc" },
    include: {
      likes: needLike,
      auction: needAuction,
      owner: needOwner,
    },
  });

  res.status(200).json({ success: true, message: "Owner NFTs fetched", data: items });
};

export const updateNftController = async (req: Request, res: Response): Promise<void> => {
  const id = toNumber(req.params.id);
  const nft = await prisma.nFT.findUnique({
    where: { id },
    select: { moderationStatus: true, ownerId: true, tokenId: true },
  });

  if (!nft) {
    throw new HttpError(404, "NFT not found", "NFT_NOT_FOUND");
  }

  await ensureUserNotBlockedById(nft.ownerId);
  if (isTradeBlockedByModeration(nft.moderationStatus)) {
    throw new HttpError(409, "This NFT is moderated and cannot be updated for trading.", "NFT_MODERATED");
  }

  const updated = await prisma.nFT.update({ where: { id }, data: req.body });
  const owner = await prisma.user.findUnique({ where: { id: updated.ownerId }, select: { walletAddress: true } });

  await logMarketplaceActivity(
    req,
    "MARKETPLACE_NFT_UPDATED",
    {
      nftId: updated.id,
      tokenId: updated.tokenId,
      ownerId: updated.ownerId,
    },
    [updated.ownerId],
  );

  emitMarketplaceEvent("marketplace.nft.updated", {
    nftId: updated.id,
    tokenId: updated.tokenId,
    ownerId: updated.ownerId,
    wallets: owner ? [owner.walletAddress.toLowerCase()] : [],
  });

  res.status(200).json({ success: true, message: "NFT updated", data: updated });
};

export const transferOwnershipController = async (req: Request, res: Response): Promise<void> => {
  const tokenId = toNumber(req.params.tokenId);
  const newOwnerId = toNumber(req.body.newOwnerId);

  const nft = await prisma.nFT.findUnique({
    where: { tokenId },
    select: { ownerId: true },
  });
  if (!nft) {
    throw new HttpError(404, "NFT not found", "NFT_NOT_FOUND");
  }

  await ensureUserNotBlockedById(nft.ownerId);
  await ensureUserNotBlockedById(newOwnerId);
  await ensureNftTradableByTokenId(tokenId);

  const previousOwner = await prisma.user.findUnique({
    where: { id: nft.ownerId },
    select: { walletAddress: true },
  });
  const nextOwner = await prisma.user.findUnique({
    where: { id: newOwnerId },
    select: { walletAddress: true },
  });

  const updated = await prisma.nFT.update({
    where: { tokenId },
    data: {
      isListed: false,
      approvedMarket: false,
      approvedAuction: false,
      owner: { connect: { id: newOwnerId } },
    },
  });

  await logMarketplaceActivity(
    req,
    "MARKETPLACE_NFT_TRANSFERRED",
    {
      nftId: updated.id,
      tokenId: updated.tokenId,
      fromOwnerId: nft.ownerId,
      toOwnerId: newOwnerId,
    },
    [nft.ownerId, newOwnerId],
  );

  emitMarketplaceEvent("marketplace.nft.transferred", {
    nftId: updated.id,
    tokenId: updated.tokenId,
    fromOwnerId: nft.ownerId,
    toOwnerId: newOwnerId,
    wallets: [previousOwner?.walletAddress, nextOwner?.walletAddress]
      .filter((wallet): wallet is string => typeof wallet === "string")
      .map((wallet) => wallet.toLowerCase()),
  });

  res.status(200).json({ success: true, message: "NFT ownership transferred", data: updated });
};

export const deleteNftController = async (req: Request, res: Response): Promise<void> => {
  const id = toNumber(req.params.id);
  const deleted = await prisma.nFT.delete({ where: { id } });

  await logMarketplaceActivity(
    req,
    "MARKETPLACE_NFT_DELETED",
    {
      nftId: deleted.id,
      tokenId: deleted.tokenId,
      ownerId: deleted.ownerId,
    },
    [deleted.ownerId],
  );

  emitMarketplaceEvent("marketplace.nft.deleted", {
    nftId: deleted.id,
    tokenId: deleted.tokenId,
    ownerId: deleted.ownerId,
    wallets: [],
  });
  res.status(200).json({ success: true, message: "NFT deleted", data: deleted });
};

export const approveAuctionNftController = async (req: Request, res: Response): Promise<void> => {
  const nftId = toNumber(req.params.id);
  const nft = await prisma.nFT.findUnique({
    where: { id: nftId },
    select: { ownerId: true, moderationStatus: true },
  });

  if (!nft) {
    throw new HttpError(404, "NFT not found", "NFT_NOT_FOUND");
  }

  await ensureUserNotBlockedById(nft.ownerId);
  if (isTradeBlockedByModeration(nft.moderationStatus)) {
    throw new HttpError(409, "This NFT is moderated and cannot be approved for auction.", "NFT_MODERATED");
  }

  const updated = await prisma.nFT.update({ where: { id: nftId }, data: { approvedAuction: true } });

  await logMarketplaceActivity(
    req,
    "MARKETPLACE_NFT_APPROVE_AUCTION",
    {
      nftId: updated.id,
      tokenId: updated.tokenId,
      ownerId: updated.ownerId,
    },
    [updated.ownerId],
  );

  emitMarketplaceEvent("marketplace.nft.approved-auction", {
    nftId: updated.id,
    tokenId: updated.tokenId,
    ownerId: updated.ownerId,
    wallets: [],
  });

  res.status(200).json({ success: true, message: "NFT approved for auction", data: updated });
};

export const approveMarketNftController = async (req: Request, res: Response): Promise<void> => {
  const nftId = toNumber(req.params.id);
  const nft = await prisma.nFT.findUnique({
    where: { id: nftId },
    select: { ownerId: true, moderationStatus: true },
  });

  if (!nft) {
    throw new HttpError(404, "NFT not found", "NFT_NOT_FOUND");
  }

  await ensureUserNotBlockedById(nft.ownerId);
  if (isTradeBlockedByModeration(nft.moderationStatus)) {
    throw new HttpError(409, "This NFT is moderated and cannot be approved for marketplace.", "NFT_MODERATED");
  }

  const updated = await prisma.nFT.update({ where: { id: nftId }, data: { approvedMarket: true } });

  await logMarketplaceActivity(
    req,
    "MARKETPLACE_NFT_APPROVE_MARKET",
    {
      nftId: updated.id,
      tokenId: updated.tokenId,
      ownerId: updated.ownerId,
    },
    [updated.ownerId],
  );

  emitMarketplaceEvent("marketplace.nft.approved-market", {
    nftId: updated.id,
    tokenId: updated.tokenId,
    ownerId: updated.ownerId,
    wallets: [],
  });

  res.status(200).json({ success: true, message: "NFT approved for marketplace", data: updated });
};

export const createAuctionController = async (req: Request, res: Response): Promise<void> => {
  const payload = req.body as Record<string, unknown>;
  const { sellerId, nftId } = extractAuctionIds(payload);

  await ensureUserNotBlockedById(sellerId);

  const nft = await prisma.nFT.findUnique({
    where: { id: nftId },
    select: { ownerId: true, moderationStatus: true, tokenId: true },
  });

  if (!nft) {
    throw new HttpError(404, "NFT not found", "NFT_NOT_FOUND");
  }

  if (nft.ownerId !== sellerId) {
    throw new HttpError(403, "Only owner can create auction for this NFT", "FORBIDDEN");
  }

  if (isTradeBlockedByModeration(nft.moderationStatus)) {
    throw new HttpError(409, "This NFT is moderated and cannot be auctioned.", "NFT_MODERATED");
  }

  const created = await prisma.auction.create({ data: req.body });
  const seller = await prisma.user.findUnique({ where: { id: sellerId }, select: { walletAddress: true } });

  await logMarketplaceActivity(
    req,
    "MARKETPLACE_AUCTION_CREATED",
    {
      auctionId: created.id,
      nftId: created.nftId,
      sellerId: created.sellerId,
      minBid: created.minBid,
      startTime: created.startTime,
      endTime: created.endTime,
    },
    [sellerId],
  );

  emitMarketplaceEvent("marketplace.auction.created", {
    auctionId: created.id,
    nftId: created.nftId,
    sellerId,
    wallets: seller ? [seller.walletAddress.toLowerCase()] : [],
  });

  res.status(201).json({ success: true, message: "Auction created", data: created });
};

export const getAuctionByIdController = async (req: Request, res: Response): Promise<void> => {
  const id = toNumber(req.params.id);
  const auction = await prisma.auction.findUnique({ where: { id } });
  res.status(200).json({ success: true, message: "Auction fetched", data: auction });
};

export const getAuctionByNftController = async (req: Request, res: Response): Promise<void> => {
  const nftId = toNumber(req.params.nftId);
  const auction = await prisma.auction.findFirst({
    where: {
      nftId,
      nft: { moderationStatus: { not: NftModerationStatus.HIDDEN } },
    },
    include: { nft: true, seller: true, highestBidder: true, bids: true },
  });
  res.status(200).json({ success: true, message: "Auction fetched", data: auction });
};

export const getAuctionsBySellerController = async (req: Request, res: Response): Promise<void> => {
  const sellerId = toNumber(req.params.sellerId);
  const items = await prisma.auction.findMany({
    where: { sellerId },
    orderBy: { createdAt: "desc" },
  });
  res.status(200).json({ success: true, message: "Seller auctions fetched", data: items });
};

export const getActiveAuctionsController = async (req: Request, res: Response): Promise<void> => {
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  const minPrice = typeof req.query.minPrice === "string" ? Number(req.query.minPrice) : undefined;
  const maxPrice = typeof req.query.maxPrice === "string" ? Number(req.query.maxPrice) : undefined;
  const endingSoon = toBoolean(req.query.endingSoon);

  const now = new Date();

  const items = await prisma.auction.findMany({
    where: {
      settled: false,
      startTime: { lte: now },
      endTime: { gt: now },
      nft: {
        moderationStatus: { in: [NftModerationStatus.ACTIVE, NftModerationStatus.FLAGGED] },
        title: search ? { contains: search, mode: "insensitive" } : undefined,
      },
      minBid: {
        gte: minPrice,
        lte: maxPrice,
      },
    },
    orderBy: endingSoon ? { endTime: "asc" } : { createdAt: "desc" },
    include: {
      nft: true,
      seller: true,
      highestBidder: true,
    },
  });

  res.status(200).json({ success: true, message: "Active auctions fetched", data: items });
};

export const updateAuctionController = async (req: Request, res: Response): Promise<void> => {
  const id = toNumber(req.params.id);
  const updated = await prisma.auction.update({ where: { id }, data: req.body });

  await logMarketplaceActivity(
    req,
    "MARKETPLACE_AUCTION_UPDATED",
    {
      auctionId: updated.id,
      nftId: updated.nftId,
      sellerId: updated.sellerId,
      settled: updated.settled,
      highestBid: updated.highestBid,
    },
    [updated.sellerId],
  );

  emitMarketplaceEvent("marketplace.auction.updated", {
    auctionId: updated.id,
    nftId: updated.nftId,
    sellerId: updated.sellerId,
    wallets: [],
  });

  res.status(200).json({ success: true, message: "Auction updated", data: updated });
};

export const updateHighestBidController = async (req: Request, res: Response): Promise<void> => {
  const auctionId = toNumber(req.params.id);
  const bidderId = toNumber(req.body.bidderId);
  const bidAmount = Number(req.body.bidAmount);

  await ensureUserNotBlockedById(bidderId);

  const auction = await prisma.auction.findUnique({
    where: { id: auctionId },
    include: { nft: { select: { moderationStatus: true } }, seller: { select: { walletAddress: true } } },
  });

  if (!auction) {
    throw new HttpError(404, "Auction not found", "AUCTION_NOT_FOUND");
  }

  if (isTradeBlockedByModeration(auction.nft.moderationStatus)) {
    throw new HttpError(409, "This NFT is moderated and cannot accept bids.", "NFT_MODERATED");
  }

  let result = auction;
  if (!auction.highestBid || bidAmount > auction.highestBid) {
    result = await prisma.auction.update({
      where: { id: auctionId },
      data: { highestBid: bidAmount, highestBidderId: bidderId },
      include: { nft: { select: { moderationStatus: true } }, seller: { select: { walletAddress: true } } },
    });
  }

  await logMarketplaceActivity(
    req,
    "MARKETPLACE_AUCTION_HIGHEST_BID_UPDATED",
    {
      auctionId: result.id,
      nftId: result.nftId,
      bidderId,
      amount: bidAmount,
    },
    [bidderId, result.sellerId],
  );

  emitMarketplaceEvent("marketplace.auction.highest-bid.updated", {
    auctionId: result.id,
    nftId: result.nftId,
    bidderId,
    amount: bidAmount,
    wallets: [result.seller.walletAddress.toLowerCase()],
  });

  res.status(200).json({ success: true, message: "Auction highest bid updated", data: result });
};

export const settleAuctionController = async (req: Request, res: Response): Promise<void> => {
  const auctionId = toNumber(req.params.id);
  const auction = await prisma.auction.findUnique({
    where: { id: auctionId },
    include: {
      nft: { select: { moderationStatus: true } },
      seller: { select: { isBlocked: true, walletAddress: true } },
      highestBidder: { select: { walletAddress: true } },
    },
  });

  if (!auction) {
    throw new HttpError(404, "Auction not found", "AUCTION_NOT_FOUND");
  }

  if (auction.seller.isBlocked) {
    throw new HttpError(
      403,
      `Your account is blocked. Contact us at ${SUPPORT_EMAIL} if this is a mistake.`,
      "USER_BLOCKED",
    );
  }

  if (isTradeBlockedByModeration(auction.nft.moderationStatus)) {
    throw new HttpError(409, "This NFT is moderated and cannot be settled.", "NFT_MODERATED");
  }

  const updated = await prisma.auction.update({
    where: { id: auctionId },
    data: { settled: true },
  });

  await logMarketplaceActivity(
    req,
    "MARKETPLACE_AUCTION_SETTLED",
    {
      auctionId: updated.id,
      nftId: updated.nftId,
      sellerId: updated.sellerId,
      highestBidderId: updated.highestBidderId,
      highestBid: updated.highestBid,
    },
    [updated.sellerId, updated.highestBidderId ?? undefined],
  );

  emitMarketplaceEvent("marketplace.auction.settled", {
    auctionId: updated.id,
    nftId: updated.nftId,
    wallets: [auction.seller.walletAddress, auction.highestBidder?.walletAddress]
      .filter((wallet): wallet is string => typeof wallet === "string")
      .map((wallet) => wallet.toLowerCase()),
  });

  res.status(200).json({ success: true, message: "Auction settled", data: updated });
};

export const deleteAuctionController = async (req: Request, res: Response): Promise<void> => {
  const id = toNumber(req.params.id);
  const deleted = await prisma.auction.delete({ where: { id } });

  await logMarketplaceActivity(
    req,
    "MARKETPLACE_AUCTION_DELETED",
    {
      auctionId: deleted.id,
      nftId: deleted.nftId,
      sellerId: deleted.sellerId,
    },
    [deleted.sellerId],
  );

  emitMarketplaceEvent("marketplace.auction.deleted", {
    auctionId: deleted.id,
    nftId: deleted.nftId,
    sellerId: deleted.sellerId,
    wallets: [],
  });

  res.status(200).json({ success: true, message: "Auction deleted", data: deleted });
};

export const fetchUserAuctionsController = async (req: Request, res: Response): Promise<void> => {
  const walletAddress = String(req.params.wallet).trim().toLowerCase();
  if (!walletAddress) {
    res.status(200).json({ success: true, message: "User auctions fetched", data: [] });
    return;
  }

  const auctions = await prisma.auction.findMany({
    where: {
      OR: [{ seller: { walletAddress } }, { highestBidder: { walletAddress } }],
    },
    include: {
      nft: true,
      highestBidder: true,
      seller: true,
      bids: { orderBy: { amount: "desc" } },
    },
    orderBy: { endTime: "desc" },
  });

  res.status(200).json({ success: true, message: "User auctions fetched", data: auctions });
};

export const createBidController = async (req: Request, res: Response): Promise<void> => {
  const auctionId = toNumber(req.params.auctionId);
  const payload = req.body as Record<string, unknown>;

  payload.auction = {
    connect: {
      id: auctionId,
    },
  };

  const { bidderId } = extractBidIds(payload);

  const bidder = await prisma.user.findUnique({
    where: { id: bidderId },
    select: { isBlocked: true, walletAddress: true },
  });

  if (bidder?.isBlocked) {
    throw new HttpError(
      403,
      `Your account is blocked. Contact us at ${SUPPORT_EMAIL} if this is a mistake.`,
      "USER_BLOCKED",
    );
  }

  const auction = await prisma.auction.findUnique({
    where: { id: auctionId },
    include: {
      nft: { select: { moderationStatus: true } },
      seller: { select: { walletAddress: true } },
    },
  });

  if (!auction) {
    throw new HttpError(404, "Auction not found", "AUCTION_NOT_FOUND");
  }

  if (isTradeBlockedByModeration(auction.nft.moderationStatus)) {
    throw new HttpError(409, "This NFT is moderated and cannot accept bids.", "NFT_MODERATED");
  }

  const amount = Number(payload.amount);
  const bid = await prisma.bid.create({ data: payload as never });

  if (!auction.highestBid || amount > auction.highestBid) {
    await prisma.auction.update({
      where: { id: auctionId },
      data: { highestBid: amount, highestBidderId: bidderId },
    });
  }

  await logMarketplaceActivity(
    req,
    "MARKETPLACE_BID_CREATED",
    {
      bidId: bid.id,
      auctionId,
      nftId: auction.nftId,
      bidderId,
      amount,
    },
    [bidderId, auction.sellerId],
  );

  emitMarketplaceEvent("marketplace.bid.created", {
    bidId: bid.id,
    auctionId,
    nftId: auction.nftId,
    bidderId,
    amount,
    wallets: [auction.seller.walletAddress, bidder?.walletAddress]
      .filter((wallet): wallet is string => typeof wallet === "string")
      .map((wallet) => wallet.toLowerCase()),
  });

  res.status(201).json({ success: true, message: "Bid created", data: bid });
};

export const getBidsByAuctionController = async (req: Request, res: Response): Promise<void> => {
  const auctionId = toNumber(req.params.auctionId);
  const includeBidder = toBoolean(req.query.includeBidder);

  const items = await prisma.bid.findMany({
    where: { auctionId },
    orderBy: { amount: "desc" },
    include: includeBidder ? { bidder: true } : undefined,
  });

  res.status(200).json({ success: true, message: "Auction bids fetched", data: items });
};

export const getBidsByUserController = async (req: Request, res: Response): Promise<void> => {
  const userId = toNumber(req.params.userId);
  const items = await prisma.bid.findMany({
    where: { bidderId: userId },
    orderBy: { createdAt: "desc" },
  });
  res.status(200).json({ success: true, message: "User bids fetched", data: items });
};

export const deleteBidController = async (req: Request, res: Response): Promise<void> => {
  const id = toNumber(req.params.id);
  const deleted = await prisma.bid.delete({ where: { id } });

  await logMarketplaceActivity(
    req,
    "MARKETPLACE_BID_DELETED",
    {
      bidId: deleted.id,
      auctionId: deleted.auctionId,
      bidderId: deleted.bidderId,
    },
    [deleted.bidderId],
  );

  emitMarketplaceEvent("marketplace.bid.deleted", {
    bidId: deleted.id,
    auctionId: deleted.auctionId,
    bidderId: deleted.bidderId,
    wallets: [],
  });
  res.status(200).json({ success: true, message: "Bid deleted", data: deleted });
};

export const getAuctionHistoryController = async (req: Request, res: Response): Promise<void> => {
  const walletAddress = String(req.params.wallet).trim().toLowerCase();
  if (!walletAddress) {
    res.status(200).json({ success: true, message: "Auction history fetched", data: [] });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { walletAddress },
    select: { id: true },
  });

  if (!user) {
    res.status(200).json({ success: true, message: "Auction history fetched", data: [] });
    return;
  }

  const auctions = await prisma.auction.findMany({
    where: {
      bids: {
        some: { bidderId: user.id },
      },
    },
    include: {
      nft: true,
      bids: {
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: {
      endTime: "desc",
    },
  });

  const now = new Date();
  const history = auctions.map((auction) => {
    const isEnded = auction.endTime < now;
    const canSettle = isEnded && !auction.settled;
    const userBids = auction.bids.filter((bid) => bid.bidderId === user.id);
    const userLastBid = userBids.length > 0 ? userBids[userBids.length - 1].amount : null;
    const status = auction.settled ? "settled" : isEnded ? "ended" : "active";
    const timeLeft = isEnded ? 0 : auction.endTime.getTime() - now.getTime();

    return {
      auction: {
        ...auction,
        nft: auction.nft,
        bids: auction.bids,
      },
      userLastBid,
      status,
      isEnded,
      canSettle,
      timeLeft,
    };
  });

  res.status(200).json({ success: true, message: "Auction history fetched", data: history });
};

export const createNftLikeController = async (req: Request, res: Response): Promise<void> => {
  const nftId = toNumber(req.params.nftId);
  const userId = toNumber(req.body.userId);
  const created = await prisma.nFTLike.create({ data: { nftId, userId } });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { walletAddress: true } });
  emitMarketplaceEvent("marketplace.like.created", {
    nftId,
    userId,
    likeId: created.id,
    wallets: user ? [user.walletAddress.toLowerCase()] : [],
  });

  res.status(201).json({ success: true, message: "NFT like created", data: created });
};

export const getNftLikesByNftController = async (req: Request, res: Response): Promise<void> => {
  const nftId = toNumber(req.params.nftId);
  const likes = await prisma.nFTLike.findMany({ where: { nftId }, orderBy: { createdAt: "desc" } });
  res.status(200).json({ success: true, message: "NFT likes fetched", data: likes });
};

export const getNftLikesByUserController = async (req: Request, res: Response): Promise<void> => {
  const userId = toNumber(req.params.userId);
  const likes = await prisma.nFTLike.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  res.status(200).json({ success: true, message: "User likes fetched", data: likes });
};

export const deleteNftLikeController = async (req: Request, res: Response): Promise<void> => {
  const nftId = toNumber(req.params.nftId);
  const userId = toNumber(req.params.userId);
  const deleted = await prisma.nFTLike.delete({ where: { nftId_userId: { nftId, userId } } });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { walletAddress: true } });
  emitMarketplaceEvent("marketplace.like.deleted", {
    nftId,
    userId,
    likeId: deleted.id,
    wallets: user ? [user.walletAddress.toLowerCase()] : [],
  });

  res.status(200).json({ success: true, message: "NFT like deleted", data: deleted });
};

export const checkNftLikeController = async (req: Request, res: Response): Promise<void> => {
  const nftId = toNumber(req.params.nftId);
  const userId = toNumber(req.params.userId);
  const like = await prisma.nFTLike.findUnique({ where: { nftId_userId: { nftId, userId } } });
  res.status(200).json({ success: true, message: "NFT like checked", data: Boolean(like) });
};

export const toggleNftLikeController = async (req: Request, res: Response): Promise<void> => {
  const nftId = toNumber(req.params.nftId);
  const userId = toNumber(req.body.userId);

  const payload = await prisma.$transaction(async (tx) => {
    const existing = await tx.nFTLike.findUnique({ where: { nftId_userId: { nftId, userId } } });
    if (existing) {
      await tx.nFTLike.delete({ where: { nftId_userId: { nftId, userId } } });
      const count = await tx.nFTLike.count({ where: { nftId } });
      return { liked: false, count };
    }

    const maxPosition = await tx.nFTLike.findFirst({
      where: { userId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const newPosition = (maxPosition?.position ?? -1) + 1;

    await tx.nFTLike.create({
      data: {
        nftId,
        userId,
        position: newPosition,
      },
    });

    const count = await tx.nFTLike.count({ where: { nftId } });
    return { liked: true, count };
  });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { walletAddress: true } });
  emitMarketplaceEvent("marketplace.like.toggled", {
    nftId,
    userId,
    ...payload,
    wallets: user ? [user.walletAddress.toLowerCase()] : [],
  });

  res.status(200).json({ success: true, message: "NFT like toggled", data: payload });
};

export const likedNftsWithDetailsController = async (req: Request, res: Response): Promise<void> => {
  const userId = toNumber(req.params.userId);
  const items = await prisma.nFTLike.findMany({
    where: {
      userId,
      nft: { moderationStatus: { not: NftModerationStatus.HIDDEN } },
    },
    include: {
      nft: {
        include: {
          owner: true,
          auction: true,
          likes: true,
          creator: true,
        },
      },
    },
    orderBy: { position: "asc" },
  });

  res.status(200).json({ success: true, message: "Liked NFTs fetched", data: items });
};

export const reorderFavoritesController = async (req: Request, res: Response): Promise<void> => {
  const userId = toNumber(req.params.userId);
  const updates = (req.body.updates ?? []) as Array<{ nftId: number; position: number }>;

  const payload = await prisma.$transaction(async (tx) => {
    for (const update of updates) {
      await tx.nFTLike.update({
        where: {
          nftId_userId: {
            nftId: update.nftId,
            userId,
          },
        },
        data: { position: update.position },
      });
    }
    return { success: true };
  });

  emitMarketplaceEvent("marketplace.favorites.reordered", {
    userId,
    updates,
    wallets: [],
  });

  res.status(200).json({ success: true, message: "Favorites reordered", data: payload });
};

export const initializeFavoritesOrderController = async (req: Request, res: Response): Promise<void> => {
  const userId = toNumber(req.params.userId);
  const likes = await prisma.nFTLike.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });

  const payload = await prisma.$transaction(async (tx) => {
    for (let index = 0; index < likes.length; index += 1) {
      await tx.nFTLike.update({
        where: {
          nftId_userId: {
            nftId: likes[index].nftId,
            userId,
          },
        },
        data: { position: index },
      });
    }

    return { success: true, count: likes.length };
  });

  emitMarketplaceEvent("marketplace.favorites.initialized", {
    userId,
    count: likes.length,
    wallets: [],
  });

  res.status(200).json({ success: true, message: "Favorites order initialized", data: payload });
};

export const createFileController = async (req: Request, res: Response): Promise<void> => {
  const created = await prisma.file.create({ data: req.body });
  emitMarketplaceEvent("marketplace.file.created", {
    fileId: created.id,
    walletId: created.walletId,
    wallets: [created.walletId.toLowerCase()],
  });
  res.status(201).json({ success: true, message: "File created", data: created });
};

export const getFilesByWalletController = async (req: Request, res: Response): Promise<void> => {
  const walletId = String(req.query.walletId);
  const mintedQuery = req.query.minted;
  const minted = typeof mintedQuery === "string" ? mintedQuery === "true" : undefined;

  const items = await prisma.file.findMany({
    where: {
      walletId,
      ...(minted !== undefined ? { isMinted: minted } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  res.status(200).json({ success: true, message: "Files fetched", data: items });
};

export const getFileByIdController = async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const file = await prisma.file.findUnique({ where: { id } });
  res.status(200).json({ success: true, message: "File fetched", data: file });
};

export const getFileTypeByIpfsController = async (req: Request, res: Response): Promise<void> => {
  const ipfs = String(req.query.ipfs);
  const file = await prisma.file.findFirst({
    where: { ipfsUrl: ipfs },
    select: { type: true, filename: true },
  });

  res.status(200).json({
    success: true,
    message: "File type fetched",
    data: { type: file?.type ?? "unknown", name: file?.filename ?? "unknown" },
  });
};

export const updateFileController = async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const updated = await prisma.file.update({ where: { id }, data: req.body });
  emitMarketplaceEvent("marketplace.file.updated", {
    fileId: updated.id,
    walletId: updated.walletId,
    wallets: [updated.walletId.toLowerCase()],
  });
  res.status(200).json({ success: true, message: "File updated", data: updated });
};

export const updateFilesByWalletController = async (req: Request, res: Response): Promise<void> => {
  const walletId = String(req.params.walletId);
  const updated = await prisma.file.updateMany({ where: { walletId }, data: req.body });
  emitMarketplaceEvent("marketplace.file.updated-many", {
    walletId,
    count: updated.count,
    wallets: [walletId.toLowerCase()],
  });
  res.status(200).json({ success: true, message: "Files updated", data: updated });
};

export const deleteFileController = async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const deleted = await prisma.file.delete({ where: { id } });
  emitMarketplaceEvent("marketplace.file.deleted", {
    fileId: deleted.id,
    walletId: deleted.walletId,
    wallets: [deleted.walletId.toLowerCase()],
  });
  res.status(200).json({ success: true, message: "File deleted", data: deleted });
};

export const deleteFilesByWalletController = async (req: Request, res: Response): Promise<void> => {
  const walletId = String(req.params.walletId);
  const deleted = await prisma.file.deleteMany({ where: { walletId } });
  emitMarketplaceEvent("marketplace.file.deleted-many", {
    walletId,
    count: deleted.count,
    wallets: [walletId.toLowerCase()],
  });
  res.status(200).json({ success: true, message: "Files deleted", data: deleted });
};

export const createUserController = async (req: Request, res: Response): Promise<void> => {
  const payload = req.body as Record<string, unknown>;
  const walletAddress = String(payload.walletAddress ?? "").trim().toLowerCase();
  // ensure stored payload uses canonical wallet format
  payload.walletAddress = walletAddress;
  const user = await prisma.user.upsert({
    where: { walletAddress },
    update: payload,
    create: payload as never,
  });

  await logMarketplaceActivity(
    req,
    "MARKETPLACE_USER_UPSERTED",
    {
      userId: user.id,
      walletAddress: user.walletAddress,
      role: user.role,
      isBlocked: user.isBlocked,
    },
    [user.id],
  );

  emitMarketplaceEvent("marketplace.user.upserted", {
    userId: user.id,
    walletAddress: user.walletAddress,
    wallets: [user.walletAddress.toLowerCase()],
  });

  res.status(201).json({ success: true, message: "User upserted", data: user });
};

export const getUserByIdController = async (req: Request, res: Response): Promise<void> => {
  const id = toNumber(req.params.id);
  const user = await prisma.user.findUnique({ where: { id } });
  res.status(200).json({ success: true, message: "User fetched", data: user });
};

export const getUserByWalletController = async (req: Request, res: Response): Promise<void> => {
  const walletAddress = String(req.params.walletAddress).trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { walletAddress } });
  res.status(200).json({ success: true, message: "User fetched", data: user });
};

export const listUsersController = async (req: Request, res: Response): Promise<void> => {
  const take = typeof req.query.take === "string" ? Number(req.query.take) : undefined;
  const skip = typeof req.query.skip === "string" ? Number(req.query.skip) : undefined;
  const users = await prisma.user.findMany({
    take,
    skip,
    orderBy: { createdAt: "desc" },
  });
  res.status(200).json({ success: true, message: "Users fetched", data: users });
};

export const updateUserController = async (req: Request, res: Response): Promise<void> => {
  const id = toNumber(req.params.id);
  const updated = await prisma.user.update({ where: { id }, data: req.body });

  await logMarketplaceActivity(
    req,
    "MARKETPLACE_USER_UPDATED",
    {
      userId: updated.id,
      walletAddress: updated.walletAddress,
      role: updated.role,
      isBlocked: updated.isBlocked,
    },
    [updated.id],
  );

  emitMarketplaceEvent("marketplace.user.updated", {
    userId: updated.id,
    walletAddress: updated.walletAddress,
    wallets: [updated.walletAddress.toLowerCase()],
  });

  res.status(200).json({ success: true, message: "User updated", data: updated });
};

export const updateUserByWalletController = async (req: Request, res: Response): Promise<void> => {
  const walletAddress = String(req.params.walletAddress).trim().toLowerCase();
  const updated = await prisma.user.update({ where: { walletAddress }, data: req.body });

  await logMarketplaceActivity(
    req,
    "MARKETPLACE_USER_UPDATED",
    {
      userId: updated.id,
      walletAddress: updated.walletAddress,
      role: updated.role,
      isBlocked: updated.isBlocked,
    },
    [updated.id],
  );

  emitMarketplaceEvent("marketplace.user.updated", {
    userId: updated.id,
    walletAddress: updated.walletAddress,
    wallets: [updated.walletAddress.toLowerCase()],
  });

  res.status(200).json({ success: true, message: "User updated", data: updated });
};

export const upsertUserController = async (req: Request, res: Response): Promise<void> => {
  const walletAddress = String(req.params.walletAddress).trim().toLowerCase();
  const payload = req.body as Record<string, unknown>;

  const upserted = await prisma.user.upsert({
    where: { walletAddress },
    create: { ...payload, walletAddress } as never,
    update: payload,
  });

  await logMarketplaceActivity(
    req,
    "MARKETPLACE_USER_UPSERTED",
    {
      userId: upserted.id,
      walletAddress: upserted.walletAddress,
      role: upserted.role,
      isBlocked: upserted.isBlocked,
    },
    [upserted.id],
  );

  emitMarketplaceEvent("marketplace.user.upserted", {
    userId: upserted.id,
    walletAddress: upserted.walletAddress,
    wallets: [upserted.walletAddress.toLowerCase()],
  });

  res.status(200).json({ success: true, message: "User upserted", data: upserted });
};

export const deleteUserController = async (req: Request, res: Response): Promise<void> => {
  const id = toNumber(req.params.id);
  const deleted = await prisma.user.delete({ where: { id } });

  await logMarketplaceActivity(
    req,
    "MARKETPLACE_USER_DELETED",
    {
      userId: deleted.id,
      walletAddress: deleted.walletAddress,
      role: deleted.role,
    },
    [deleted.id],
  );

  emitMarketplaceEvent("marketplace.user.deleted", {
    userId: deleted.id,
    walletAddress: deleted.walletAddress,
    wallets: [deleted.walletAddress.toLowerCase()],
  });

  res.status(200).json({ success: true, message: "User deleted", data: deleted });
};

export const deleteUserByWalletController = async (req: Request, res: Response): Promise<void> => {
  const walletAddress = String(req.params.walletAddress).trim().toLowerCase();
  const deleted = await prisma.user.delete({ where: { walletAddress } });

  await logMarketplaceActivity(
    req,
    "MARKETPLACE_USER_DELETED",
    {
      userId: deleted.id,
      walletAddress: deleted.walletAddress,
      role: deleted.role,
    },
    [deleted.id],
  );

  emitMarketplaceEvent("marketplace.user.deleted", {
    userId: deleted.id,
    walletAddress: deleted.walletAddress,
    wallets: [deleted.walletAddress.toLowerCase()],
  });

  res.status(200).json({ success: true, message: "User deleted", data: deleted });
};

export const trendingSellersController = async (req: Request, res: Response): Promise<void> => {
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 2;
  const users = await prisma.user.findMany({
    include: {
      nftsOwned: {
        include: {
          likes: true,
        },
      },
    },
  });

  const sellersWithMetrics = users
    .map((user) => {
      const totalLikes = user.nftsOwned.reduce((sum, nft) => sum + nft.likes.length, 0);
      const nftCount = user.nftsOwned.length;
      return {
        id: user.id,
        name: user.name,
        walletAddress: user.walletAddress,
        image: user.avatarUrl,
        totalLikes,
        nftCount,
        createdAt: user.createdAt,
      };
    })
    .sort((a, b) => {
      if (a.totalLikes !== b.totalLikes) {
        return b.totalLikes - a.totalLikes;
      }
      return b.createdAt.getTime() - a.createdAt.getTime();
    })
    .slice(0, limit);

  res.status(200).json({ success: true, message: "Trending sellers fetched", data: sellersWithMetrics });
};

export const searchUsersController = async (req: Request, res: Response): Promise<void> => {
  const q = String(req.query.q ?? "").trim();
  if (!q) {
    res.status(200).json({ success: true, message: "Users searched", data: [] });
    return;
  }

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { walletAddress: { contains: q, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      walletAddress: true,
      name: true,
      avatarUrl: true,
    },
    take: 15,
    orderBy: { createdAt: "desc" },
  });

  res.status(200).json({ success: true, message: "Users searched", data: users });
};

export const artistProfileController = async (req: Request, res: Response): Promise<void> => {
  const walletAddress = String(req.params.walletAddress).trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { walletAddress },
    include: {
      nftsOwned: {
        where: {
          moderationStatus: {
            not: NftModerationStatus.HIDDEN,
          },
          OR: [{ isListed: true }, { auction: { isNot: null } }],
        },
        include: {
          auction: {
            include: {
              highestBidder: {
                select: {
                  walletAddress: true,
                  name: true,
                },
              },
            },
          },
          likes: true,
          owner: {
            select: {
              walletAddress: true,
              name: true,
              avatarUrl: true,
            },
          },
          creator: {
            select: {
              walletAddress: true,
              name: true,
              avatarUrl: true,
            },
          },
        },
      },
    },
  });

  if (!user) {
    res.status(200).json({ success: true, message: "Artist profile fetched", data: null });
    return;
  }

  const totalNfts = user.nftsOwned.length;
  const activeListings = user.nftsOwned.filter((nft) => nft.isListed && !nft.auction).length;
  const activeAuctions = user.nftsOwned.filter((nft) => nft.auction).length;

  res.status(200).json({
    success: true,
    message: "Artist profile fetched",
    data: {
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        name: user.name,
        avatarUrl: user.avatarUrl,
        email: user.email,
      },
      stats: {
        totalNFTs: totalNfts,
        activeListings,
        activeAuctions,
      },
      nfts: user.nftsOwned,
    },
  });
};

export const marketplaceErrorController = async (_req: Request, res: Response): Promise<void> => {
  res.status(500).json({
    success: false,
    message: toErrorMessage(new Error("Unhandled marketplace error")),
    code: "INTERNAL_SERVER_ERROR",
  });
};
