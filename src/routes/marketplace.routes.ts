import { Router } from "express";
import {
  approveAuctionNftController,
  approveMarketNftController,
  artistProfileController,
  checkNftLikeController,
  createAuctionController,
  createBidController,
  createFileController,
  createNftController,
  createNftLikeController,
  createUserController,
  deleteAuctionController,
  deleteBidController,
  deleteFileController,
  deleteFilesByWalletController,
  deleteNftController,
  deleteNftLikeController,
  deleteUserByWalletController,
  deleteUserController,
  fetchUserAuctionsController,
  getActiveAuctionsController,
  getAuctionByIdController,
  getAuctionByNftController,
  getAuctionHistoryController,
  getAuctionsBySellerController,
  getBidsByAuctionController,
  getBidsByUserController,
  getFileByIdController,
  getFileTypeByIpfsController,
  getFilesByWalletController,
  getNftByIdController,
  getNftByTokenIdController,
  getNftLikesByNftController,
  getNftLikesByUserController,
  getNftsByCreatorController,
  getNftsByOwnerController,
  getUserByIdController,
  getUserByWalletController,
  getVisibleNftByTokenIdController,
  initializeFavoritesOrderController,
  likedNftsWithDetailsController,
  listNftsController,
  listUsersController,
  reorderFavoritesController,
  searchUsersController,
  settleAuctionController,
  streamMarketplaceController,
  toggleNftLikeController,
  transferOwnershipController,
  trendingSellersController,
  updateAuctionController,
  updateFileController,
  updateFilesByWalletController,
  updateHighestBidController,
  updateNftController,
  updateUserByWalletController,
  updateUserController,
  upsertUserController,
} from "../controllers/marketplace.controller";
import { asyncHandler } from "../middleware/async-handler";
import { validate } from "../middleware/validate";
import {
  activeAuctionsSchema,
  artistProfileSchema,
  auctionByNftSchema,
  auctionBidsSchema,
  auctionIdParamSchema,
  bidIdParamSchema,
  createAuctionSchema,
  createBidSchema,
  createFileSchema,
  createNftLikeSchema,
  createNftSchema,
  createUserSchema,
  creatorIdParamSchema,
  fileIdParamSchema,
  fileTypeByIpfsSchema,
  filesByWalletParamSchema,
  listFilesSchema,
  listNftsSchema,
  listUsersSchema,
  marketplaceStreamSchema,
  nftIdParamSchema,
  nftIdWithUserSchema,
  ownerNftsSchema,
  reorderFavoritesSchema,
  searchUsersSchema,
  sellerAuctionsSchema,
  tokenIdParamSchema,
  toggleNftLikeSchema,
  transferOwnershipSchema,
  trendingSellersSchema,
  updateAuctionSchema,
  updateFileSchema,
  updateHighestBidSchema,
  updateNftSchema,
  updateUserByWalletSchema,
  updateUserSchema,
  upsertUserSchema,
  userByIdSchema,
  userByWalletSchema,
  userIdParamSchema,
  walletParamSchema,
} from "../validators/marketplace.validators";

export const marketplaceRouter = Router();

marketplaceRouter.get("/stream", validate(marketplaceStreamSchema), asyncHandler(streamMarketplaceController));

marketplaceRouter.post("/nfts", validate(createNftSchema), asyncHandler(createNftController));
marketplaceRouter.get("/nfts", validate(listNftsSchema), asyncHandler(listNftsController));
marketplaceRouter.get("/nfts/:id", validate(nftIdParamSchema), asyncHandler(getNftByIdController));
marketplaceRouter.get("/nfts/token/:tokenId", validate(tokenIdParamSchema), asyncHandler(getNftByTokenIdController));
marketplaceRouter.get(
  "/nfts/token/:tokenId/visible",
  validate(tokenIdParamSchema),
  asyncHandler(getVisibleNftByTokenIdController),
);
marketplaceRouter.get(
  "/users/:creatorId/nfts-created",
  validate(creatorIdParamSchema),
  asyncHandler(getNftsByCreatorController),
);
marketplaceRouter.get("/users/:ownerId/nfts-owned", validate(ownerNftsSchema), asyncHandler(getNftsByOwnerController));
marketplaceRouter.patch("/nfts/:id", validate(updateNftSchema), asyncHandler(updateNftController));
marketplaceRouter.post(
  "/nfts/token/:tokenId/transfer",
  validate(transferOwnershipSchema),
  asyncHandler(transferOwnershipController),
);
marketplaceRouter.delete("/nfts/:id", validate(nftIdParamSchema), asyncHandler(deleteNftController));
marketplaceRouter.post(
  "/nfts/:id/approve-auction",
  validate(nftIdParamSchema),
  asyncHandler(approveAuctionNftController),
);
marketplaceRouter.post(
  "/nfts/:id/approve-market",
  validate(nftIdParamSchema),
  asyncHandler(approveMarketNftController),
);

marketplaceRouter.post("/auctions", validate(createAuctionSchema), asyncHandler(createAuctionController));
marketplaceRouter.get("/auctions/active", validate(activeAuctionsSchema), asyncHandler(getActiveAuctionsController));
marketplaceRouter.get("/auctions/:id", validate(auctionIdParamSchema), asyncHandler(getAuctionByIdController));
marketplaceRouter.get("/nfts/:nftId/auction", validate(auctionByNftSchema), asyncHandler(getAuctionByNftController));
marketplaceRouter.get(
  "/users/:sellerId/auctions",
  validate(sellerAuctionsSchema),
  asyncHandler(getAuctionsBySellerController),
);
marketplaceRouter.patch("/auctions/:id", validate(updateAuctionSchema), asyncHandler(updateAuctionController));
marketplaceRouter.patch(
  "/auctions/:id/highest-bid",
  validate(updateHighestBidSchema),
  asyncHandler(updateHighestBidController),
);
marketplaceRouter.post("/auctions/:id/settle", validate(auctionIdParamSchema), asyncHandler(settleAuctionController));
marketplaceRouter.delete("/auctions/:id", validate(auctionIdParamSchema), asyncHandler(deleteAuctionController));
marketplaceRouter.get(
  "/users/wallet/:wallet/auctions",
  validate(walletParamSchema),
  asyncHandler(fetchUserAuctionsController),
);
marketplaceRouter.get(
  "/users/wallet/:wallet/auction-history",
  validate(walletParamSchema),
  asyncHandler(getAuctionHistoryController),
);

marketplaceRouter.post("/auctions/:auctionId/bids", validate(createBidSchema), asyncHandler(createBidController));
marketplaceRouter.get(
  "/auctions/:auctionId/bids",
  validate(auctionBidsSchema),
  asyncHandler(getBidsByAuctionController),
);
marketplaceRouter.get("/users/:userId/bids", validate(userIdParamSchema), asyncHandler(getBidsByUserController));
marketplaceRouter.delete("/bids/:id", validate(bidIdParamSchema), asyncHandler(deleteBidController));

marketplaceRouter.post("/nfts/:nftId/likes", validate(createNftLikeSchema), asyncHandler(createNftLikeController));
marketplaceRouter.get("/nfts/:nftId/likes", validate(auctionByNftSchema), asyncHandler(getNftLikesByNftController));
marketplaceRouter.get("/users/:userId/likes", validate(userIdParamSchema), asyncHandler(getNftLikesByUserController));
marketplaceRouter.delete(
  "/nfts/:nftId/likes/:userId",
  validate(nftIdWithUserSchema),
  asyncHandler(deleteNftLikeController),
);
marketplaceRouter.get(
  "/nfts/:nftId/likes/:userId",
  validate(nftIdWithUserSchema),
  asyncHandler(checkNftLikeController),
);
marketplaceRouter.post(
  "/nfts/:nftId/likes/toggle",
  validate(toggleNftLikeSchema),
  asyncHandler(toggleNftLikeController),
);
marketplaceRouter.get("/users/:userId/liked-nfts", validate(userIdParamSchema), asyncHandler(likedNftsWithDetailsController));
marketplaceRouter.patch(
  "/users/:userId/favorites/reorder",
  validate(reorderFavoritesSchema),
  asyncHandler(reorderFavoritesController),
);
marketplaceRouter.post(
  "/users/:userId/favorites/init",
  validate(userIdParamSchema),
  asyncHandler(initializeFavoritesOrderController),
);

marketplaceRouter.post("/files", validate(createFileSchema), asyncHandler(createFileController));
marketplaceRouter.get("/files", validate(listFilesSchema), asyncHandler(getFilesByWalletController));
marketplaceRouter.get("/files/:id", validate(fileIdParamSchema), asyncHandler(getFileByIdController));
marketplaceRouter.get("/files/by-ipfs", validate(fileTypeByIpfsSchema), asyncHandler(getFileTypeByIpfsController));
marketplaceRouter.patch("/files/:id", validate(updateFileSchema), asyncHandler(updateFileController));
marketplaceRouter.patch(
  "/files/by-wallet/:walletId",
  validate(filesByWalletParamSchema),
  asyncHandler(updateFilesByWalletController),
);
marketplaceRouter.delete("/files/:id", validate(fileIdParamSchema), asyncHandler(deleteFileController));
marketplaceRouter.delete(
  "/files/by-wallet/:walletId",
  validate(filesByWalletParamSchema),
  asyncHandler(deleteFilesByWalletController),
);

marketplaceRouter.post("/users", validate(createUserSchema), asyncHandler(createUserController));
marketplaceRouter.get("/users", validate(listUsersSchema), asyncHandler(listUsersController));
marketplaceRouter.get("/users/search", validate(searchUsersSchema), asyncHandler(searchUsersController));
marketplaceRouter.get("/users/trending-sellers", validate(trendingSellersSchema), asyncHandler(trendingSellersController));
marketplaceRouter.get("/users/:id", validate(userByIdSchema), asyncHandler(getUserByIdController));
marketplaceRouter.get(
  "/users/by-wallet/:walletAddress",
  validate(userByWalletSchema),
  asyncHandler(getUserByWalletController),
);
marketplaceRouter.patch("/users/:id", validate(updateUserSchema), asyncHandler(updateUserController));
marketplaceRouter.patch(
  "/users/by-wallet/:walletAddress",
  validate(updateUserByWalletSchema),
  asyncHandler(updateUserByWalletController),
);
marketplaceRouter.put(
  "/users/by-wallet/:walletAddress",
  validate(upsertUserSchema),
  asyncHandler(upsertUserController),
);
marketplaceRouter.delete("/users/:id", validate(userByIdSchema), asyncHandler(deleteUserController));
marketplaceRouter.delete(
  "/users/by-wallet/:walletAddress",
  validate(userByWalletSchema),
  asyncHandler(deleteUserByWalletController),
);

marketplaceRouter.get(
  "/artists/:walletAddress/profile",
  validate(artistProfileSchema),
  asyncHandler(artistProfileController),
);
