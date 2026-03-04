import { z } from "zod";

const positiveInt = z.coerce.number().int().positive();

const unknownOptional = z.unknown().optional();

const nftLikePositionUpdateSchema = z.object({
  nftId: positiveInt,
  position: z.coerce.number().int().min(0),
});

export const marketplaceStreamSchema = z.object({
  query: z.object({
    wallet: z.string().trim().min(1).optional(),
    nftId: z.coerce.number().int().positive().optional(),
    auctionId: z.coerce.number().int().positive().optional(),
  }),
  body: unknownOptional,
  params: unknownOptional,
});

export const createNftSchema = z.object({
  body: z.record(z.string(), z.unknown()),
  query: unknownOptional,
  params: unknownOptional,
});

export const nftIdParamSchema = z.object({
  params: z.object({ id: positiveInt }),
  body: unknownOptional,
  query: unknownOptional,
});

export const listNftsSchema = z.object({
  query: z.object({
    likes: z.enum(["true", "false"]).optional(),
  }),
  body: unknownOptional,
  params: unknownOptional,
});

export const tokenIdParamSchema = z.object({
  params: z.object({ tokenId: positiveInt }),
  body: unknownOptional,
  query: unknownOptional,
});

export const creatorIdParamSchema = z.object({
  params: z.object({ creatorId: positiveInt }),
  body: unknownOptional,
  query: unknownOptional,
});

export const ownerNftsSchema = z.object({
  params: z.object({ ownerId: positiveInt }),
  query: z.object({
    needLike: z.enum(["true", "false"]).optional(),
    needAuction: z.enum(["true", "false"]).optional(),
    needOwner: z.enum(["true", "false"]).optional(),
  }),
  body: unknownOptional,
});

export const updateNftSchema = z.object({
  params: z.object({ id: positiveInt }),
  body: z.record(z.string(), z.unknown()),
  query: unknownOptional,
});

export const transferOwnershipSchema = z.object({
  params: z.object({ tokenId: positiveInt }),
  body: z.object({ newOwnerId: positiveInt }),
  query: unknownOptional,
});

export const createAuctionSchema = z.object({
  body: z.record(z.string(), z.unknown()),
  query: unknownOptional,
  params: unknownOptional,
});

export const auctionIdParamSchema = z.object({
  params: z.object({ id: positiveInt }),
  body: unknownOptional,
  query: unknownOptional,
});

export const auctionByNftSchema = z.object({
  params: z.object({ nftId: positiveInt }),
  body: unknownOptional,
  query: unknownOptional,
});

export const sellerAuctionsSchema = z.object({
  params: z.object({ sellerId: positiveInt }),
  body: unknownOptional,
  query: unknownOptional,
});

export const activeAuctionsSchema = z.object({
  query: z.object({
    search: z.string().trim().optional(),
    minPrice: z.coerce.number().nonnegative().optional(),
    maxPrice: z.coerce.number().nonnegative().optional(),
    endingSoon: z.enum(["true", "false"]).optional(),
  }),
  body: unknownOptional,
  params: unknownOptional,
});

export const updateAuctionSchema = z.object({
  params: z.object({ id: positiveInt }),
  body: z.record(z.string(), z.unknown()),
  query: unknownOptional,
});

export const updateHighestBidSchema = z.object({
  params: z.object({ id: positiveInt }),
  body: z.object({
    bidderId: positiveInt,
    bidAmount: z.coerce.number().positive(),
  }),
  query: unknownOptional,
});

export const walletParamSchema = z.object({
  params: z.object({ wallet: z.string().trim().min(1) }),
  body: unknownOptional,
  query: unknownOptional,
});

export const createBidSchema = z.object({
  params: z.object({ auctionId: positiveInt }),
  body: z.record(z.string(), z.unknown()),
  query: unknownOptional,
});

export const auctionBidsSchema = z.object({
  params: z.object({ auctionId: positiveInt }),
  query: z.object({ includeBidder: z.enum(["true", "false"]).optional() }),
  body: unknownOptional,
});

export const userIdParamSchema = z.object({
  params: z.object({ userId: positiveInt }),
  body: unknownOptional,
  query: unknownOptional,
});

export const bidIdParamSchema = z.object({
  params: z.object({ id: positiveInt }),
  body: unknownOptional,
  query: unknownOptional,
});

export const createNftLikeSchema = z.object({
  params: z.object({ nftId: positiveInt }),
  body: z.object({ userId: positiveInt }),
  query: unknownOptional,
});

export const nftIdWithUserSchema = z.object({
  params: z.object({ nftId: positiveInt, userId: positiveInt }),
  body: unknownOptional,
  query: unknownOptional,
});

export const toggleNftLikeSchema = z.object({
  params: z.object({ nftId: positiveInt }),
  body: z.object({ userId: positiveInt }),
  query: unknownOptional,
});

export const reorderFavoritesSchema = z.object({
  params: z.object({ userId: positiveInt }),
  body: z.object({ updates: z.array(nftLikePositionUpdateSchema) }),
  query: unknownOptional,
});

export const createFileSchema = z.object({
  body: z.record(z.string(), z.unknown()),
  params: unknownOptional,
  query: unknownOptional,
});

export const listFilesSchema = z.object({
  query: z.object({
    walletId: z.string().trim().min(1),
    minted: z.enum(["true", "false"]).optional(),
  }),
  body: unknownOptional,
  params: unknownOptional,
});

export const fileIdParamSchema = z.object({
  params: z.object({ id: z.string().trim().min(1) }),
  body: unknownOptional,
  query: unknownOptional,
});

export const fileTypeByIpfsSchema = z.object({
  query: z.object({
    ipfs: z.string().trim().min(1),
  }),
  body: unknownOptional,
  params: unknownOptional,
});

export const updateFileSchema = z.object({
  params: z.object({ id: z.string().trim().min(1) }),
  body: z.record(z.string(), z.unknown()),
  query: unknownOptional,
});

export const filesByWalletParamSchema = z.object({
  params: z.object({ walletId: z.string().trim().min(1) }),
  body: z.record(z.string(), z.unknown()).optional(),
  query: unknownOptional,
});

export const createUserSchema = z.object({
  body: z.object({
    walletAddress: z.string().trim().min(1),
  }).and(z.record(z.string(), z.unknown())),
  query: unknownOptional,
  params: unknownOptional,
});

export const userByIdSchema = z.object({
  params: z.object({ id: positiveInt }),
  body: unknownOptional,
  query: unknownOptional,
});

export const userByWalletSchema = z.object({
  params: z.object({ walletAddress: z.string().trim().min(1) }),
  body: unknownOptional,
  query: unknownOptional,
});

export const listUsersSchema = z.object({
  query: z.object({
    take: z.coerce.number().int().positive().optional(),
    skip: z.coerce.number().int().min(0).optional(),
  }),
  body: unknownOptional,
  params: unknownOptional,
});

export const updateUserSchema = z.object({
  params: z.object({ id: positiveInt }),
  body: z.record(z.string(), z.unknown()),
  query: unknownOptional,
});

export const updateUserByWalletSchema = z.object({
  params: z.object({ walletAddress: z.string().trim().min(1) }),
  body: z.record(z.string(), z.unknown()),
  query: unknownOptional,
});

export const upsertUserSchema = z.object({
  params: z.object({ walletAddress: z.string().trim().min(1) }),
  body: z.record(z.string(), z.unknown()),
  query: unknownOptional,
});

export const trendingSellersSchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().positive().optional(),
  }),
  params: unknownOptional,
  body: unknownOptional,
});

export const searchUsersSchema = z.object({
  query: z.object({
    q: z.string().trim().min(1),
  }),
  params: unknownOptional,
  body: unknownOptional,
});

export const artistProfileSchema = z.object({
  params: z.object({
    walletAddress: z.string().trim().min(1),
  }),
  query: unknownOptional,
  body: unknownOptional,
});
