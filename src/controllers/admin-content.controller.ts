import type { Request, Response } from "express";
import { HttpError } from "../lib/http-error";
import { prisma } from "../lib/prisma";
import { logActivity } from "../services/activity-log.service";

type NftModerationStatus = "ACTIVE" | "FLAGGED" | "DELISTED" | "HIDDEN";

const getIpAddress = (req: Request): string | null => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0]?.trim() ?? null;
  }
  return req.ip ?? null;
};

export const getDashboardStatsController = async (_req: Request, res: Response): Promise<void> => {
  const [
    totalUsers,
    blockedUsers,
    totalAdmins,
    totalNfts,
    listedNfts,
    flaggedNfts,
    totalAuctions,
    frozenAuctions,
    actions24h,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isBlocked: true } }),
    prisma.user.count({ where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } } }),
    prisma.nFT.count(),
    prisma.nFT.count({ where: { isListed: true } }),
    prisma.nFT.count({ where: { moderationStatus: "FLAGGED" } }),
    prisma.auction.count(),
    prisma.auction.count({ where: { frozen: true } }),
    prisma.activityLog.count({
      where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
  ]);

  res.status(200).json({
    success: true,
    message: "Dashboard stats fetched",
    data: {
      totalUsers,
      blockedUsers,
      totalAdmins,
      totalNfts,
      listedNfts,
      flaggedNfts,
      totalAuctions,
      frozenAuctions,
      actions24h,
    },
  });
};

export const listNftsController = async (req: Request, res: Response): Promise<void> => {
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const status = typeof req.query.status === "string" ? (req.query.status as NftModerationStatus) : undefined;
  const listed = typeof req.query.listed === "string" ? req.query.listed : undefined;
  const page = Number(req.query.page ?? 1);
  const pageSize = Number(req.query.pageSize ?? 10);

  const whereClause: Record<string, unknown> = {
    ...(q
      ? {
          OR: [
            { tokenId: Number.isNaN(Number(q)) ? undefined : Number(q) },
            { name: { contains: q, mode: "insensitive" as const } },
            { title: { contains: q, mode: "insensitive" as const } },
            { owner: { walletAddress: { contains: q, mode: "insensitive" as const } } },
          ].filter(Boolean),
        }
      : {}),
    ...(status ? { moderationStatus: status } : {}),
    ...(listed === "true" ? { isListed: true } : {}),
    ...(listed === "false" ? { isListed: false } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.nFT.findMany({
      where: whereClause,
      select: {
        id: true,
        tokenId: true,
        name: true,
        title: true,
        imageUrl: true,
        isListed: true,
        approvedAuction: true,
        approvedMarket: true,
        moderationStatus: true,
        moderationReason: true,
        createdAt: true,
        updatedAt: true,
        owner: {
          select: {
            id: true,
            walletAddress: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.nFT.count({ where: whereClause }),
  ]);

  res.status(200).json({
    success: true,
    message: "NFTs fetched",
    data: {
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    },
  });
};

export const updateNftStatusController = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const { status, reason } = req.body as { status: NftModerationStatus; reason?: string };

  const nft = await prisma.nFT.findUnique({
    where: { id },
    select: { id: true, tokenId: true, moderationStatus: true, isListed: true },
  });

  if (!nft) {
    throw new HttpError(404, "NFT not found", "NFT_NOT_FOUND");
  }

  const updated = await prisma.nFT.update({
    where: { id },
    data: {
      moderationStatus: status,
      moderationReason: reason ?? null,
      moderatedAt: new Date(),
      moderatedById: req.authUser?.userId ?? null,
      ...(status === "DELISTED" ? { isListed: false } : {}),
    },
    select: {
      id: true,
      tokenId: true,
      moderationStatus: true,
      moderationReason: true,
      isListed: true,
      updatedAt: true,
    },
  });

  await logActivity({
    userId: req.authUser!.userId,
    action: "NFT_STATUS_UPDATED",
    metadata: {
      nftId: id,
      tokenId: nft.tokenId,
      previousStatus: nft.moderationStatus,
      nextStatus: status,
      reason: reason ?? null,
    },
    ipAddress: getIpAddress(req),
  });

  res.status(200).json({
    success: true,
    message: "NFT status updated",
    data: updated,
  });
};

export const delistNftController = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const { reason, txHash } = req.body as { reason?: string; txHash?: string };

  const nft = await prisma.nFT.findUnique({
    where: { id },
    select: { id: true, tokenId: true, isListed: true, moderationStatus: true },
  });

  if (!nft) {
    throw new HttpError(404, "NFT not found", "NFT_NOT_FOUND");
  }

  const updated = await prisma.nFT.update({
    where: { id },
    data: {
      isListed: false,
      moderationStatus: "DELISTED",
      moderationReason: reason ?? null,
      moderatedAt: new Date(),
      moderatedById: req.authUser?.userId ?? null,
    },
    select: {
      id: true,
      tokenId: true,
      isListed: true,
      moderationStatus: true,
      moderationReason: true,
      updatedAt: true,
    },
  });

  await logActivity({
    userId: req.authUser!.userId,
    action: "NFT_DELISTED",
    metadata: {
      nftId: id,
      tokenId: nft.tokenId,
      previousListed: nft.isListed,
      txHash: txHash ?? null,
      reason: reason ?? null,
    },
    ipAddress: getIpAddress(req),
  });

  res.status(200).json({
    success: true,
    message: "NFT delisted",
    data: updated,
  });
};

export const listAuctionsController = async (req: Request, res: Response): Promise<void> => {
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const frozen = typeof req.query.frozen === "string" ? req.query.frozen : undefined;
  const settled = typeof req.query.settled === "string" ? req.query.settled : undefined;
  const page = Number(req.query.page ?? 1);
  const pageSize = Number(req.query.pageSize ?? 10);

  const whereClause: Record<string, unknown> = {
    ...(q
      ? {
          OR: [
            { nft: { tokenId: Number.isNaN(Number(q)) ? undefined : Number(q) } },
            { nft: { title: { contains: q, mode: "insensitive" as const } } },
            { seller: { walletAddress: { contains: q, mode: "insensitive" as const } } },
          ].filter(Boolean),
        }
      : {}),
    ...(frozen === "true" ? { frozen: true } : {}),
    ...(frozen === "false" ? { frozen: false } : {}),
    ...(settled === "true" ? { settled: true } : {}),
    ...(settled === "false" ? { settled: false } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.auction.findMany({
      where: whereClause,
      select: {
        id: true,
        nftId: true,
        sellerId: true,
        minBid: true,
        highestBid: true,
        highestBidderId: true,
        startTime: true,
        endTime: true,
        settled: true,
        frozen: true,
        frozenAt: true,
        updatedAt: true,
        nft: {
          select: {
            tokenId: true,
            title: true,
            imageUrl: true,
            moderationStatus: true,
          },
        },
        seller: {
          select: {
            walletAddress: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auction.count({ where: whereClause }),
  ]);

  res.status(200).json({
    success: true,
    message: "Auctions fetched",
    data: {
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    },
  });
};

export const freezeAuctionController = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const { frozen, reason } = req.body as { frozen: boolean; reason?: string };

  const auction = await prisma.auction.findUnique({
    where: { id },
    select: { id: true, nftId: true, frozen: true, settled: true },
  });

  if (!auction) {
    throw new HttpError(404, "Auction not found", "AUCTION_NOT_FOUND");
  }

  const updated = await prisma.auction.update({
    where: { id },
    data: {
      frozen,
      frozenAt: frozen ? new Date() : null,
      frozenById: frozen ? (req.authUser?.userId ?? null) : null,
    },
    select: {
      id: true,
      frozen: true,
      frozenAt: true,
      settled: true,
      updatedAt: true,
    },
  });

  await logActivity({
    userId: req.authUser!.userId,
    action: frozen ? "AUCTION_FROZEN" : "AUCTION_UNFROZEN",
    metadata: {
      auctionId: id,
      nftId: auction.nftId,
      previousFrozen: auction.frozen,
      nextFrozen: frozen,
      reason: reason ?? null,
    },
    ipAddress: getIpAddress(req),
  });

  res.status(200).json({
    success: true,
    message: frozen ? "Auction frozen" : "Auction unfrozen",
    data: updated,
  });
};

export const listAdminActivityController = async (req: Request, res: Response): Promise<void> => {
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const page = Number(req.query.page ?? 1);
  const pageSize = Number(req.query.pageSize ?? 20);

  const whereClause: Record<string, unknown> = {
    ...(q
      ? {
          OR: [
            { action: { contains: q, mode: "insensitive" as const } },
            { user: { walletAddress: { contains: q, mode: "insensitive" as const } } },
            { user: { name: { contains: q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.activityLog.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        action: true,
        metadata: true,
        ipAddress: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            walletAddress: true,
            name: true,
            role: true,
          },
        },
      },
    }),
    prisma.activityLog.count({ where: whereClause }),
  ]);

  res.status(200).json({
    success: true,
    message: "Activity fetched",
    data: {
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    },
  });
};
