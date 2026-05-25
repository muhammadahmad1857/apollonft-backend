/**
 * Seed Vector DB Script
 *
 * Fetches NFTs, Auctions, and Bid data from PostgreSQL (via Prisma),
 * chunks it into structured natural-language text, embeds with Gemini
 * (gemini-embedding-001, 3072 dims), and upserts into Qdrant.
 *
 * Chunk types produced:
 *   - "nft"         : One chunk per NFT with full metadata
 *   - "auction"     : One chunk per Auction with NFT context
 *   - "bid_summary" : One chunk per Auction that has bids (aggregated history)
 *
 * Usage:
 *   pnpm seed:vectordb
 *   pnpm seed:vectordb --recreate   (drops and recreates collection)
 *
 * Required env vars (add to .env):
 *   DATABASE_URL      (already exists)
 *   GEMINI_API_KEY
 *   QDRANT_URL        e.g. http://localhost:6333
 *   QDRANT_API_KEY    (optional, for Qdrant Cloud)
 */

import dotenv from "dotenv";
dotenv.config();

import { createHash } from "crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { QdrantClient } from "@qdrant/js-client-rest";
import { GoogleGenAI } from "@google/genai";

// ─── Config ──────────────────────────────────────────────────────────────────

const COLLECTION_NAME = "apollonft_knowledge";
const EMBEDDING_MODEL = "gemini-embedding-001";
const VECTOR_SIZE = 3072; // gemini-embedding-001 output dimension
const EMBED_BATCH_SIZE = 50; // Gemini embedding batch size
const QDRANT_UPSERT_BATCH = 100;
const EMBED_MAX_RETRIES = 6;
const EMBED_BASE_DELAY_MS = 60_000;

// ─── Clients ─────────────────────────────────────────────────────────────────

function getEnv(key: string, required = true): string {
  const val = process.env[key];
  if (required && !val) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
  return val ?? "";
}

const adapter = new PrismaPg({ connectionString: getEnv("DATABASE_URL") });
const prisma = new PrismaClient({ adapter });

const qdrant = new QdrantClient({
  url: getEnv("QDRANT_URL"),
  apiKey: getEnv("QDRANT_API_KEY", false) || undefined,
});

const genAI = new GoogleGenAI({ apiKey: getEnv("GEMINI_API_KEY") });

// ─── Types ───────────────────────────────────────────────────────────────────

type ChunkType = "nft" | "auction" | "bid_summary";

interface Chunk {
  id: string; // deterministic string id e.g. "nft_42"
  type: ChunkType;
  text: string;
  payload: Record<string, unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const maybeStatus = (err as { status?: number }).status;
  if (maybeStatus === 429) return true;

  const message = (err as { message?: string }).message ?? "";
  return message.includes('"code":429') || message.toLowerCase().includes("rate");
}

function parseRetryDelayMs(err: unknown): number | null {
  const message = (err as { message?: string })?.message;
  if (!message) return null;

  // Gemini sometimes includes retryDelay like "51s" in the error payload.
  const match = message.match(/"retryDelay"\s*:\s*"(\d+)s"/i);
  if (!match) return null;

  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds * 1_000;
}

// ─── Embedding ───────────────────────────────────────────────────────────────

/**
 * Embed an array of texts in batches using Gemini embeddings.
 * Uses RETRIEVAL_DOCUMENT task type so vectors are optimised for storage/search.
 * The new @google/genai SDK passes contents[] directly and returns one
 * embedding per content item.
 */
async function embedTexts(texts: string[]): Promise<number[][]> {
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    process.stdout.write(
      `  Embedding ${i + 1}–${Math.min(i + EMBED_BATCH_SIZE, texts.length)} / ${texts.length} ...\r`
    );

    let attempt = 0;
    let result: Awaited<ReturnType<typeof genAI.models.embedContent>> | null = null;

    while (attempt <= EMBED_MAX_RETRIES) {
      try {
        result = await genAI.models.embedContent({
          model: EMBEDDING_MODEL,
          contents: batch.map(t => ({ role: "user", parts: [{ text: t }] })),
          config: { taskType: "RETRIEVAL_DOCUMENT" },
        });
        break;
      } catch (err) {
        attempt++;
        if (!isRateLimitError(err) || attempt > EMBED_MAX_RETRIES) {
          throw err;
        }

        console.error(
          `\nEmbedding error on batch ${i + 1}-${Math.min(i + EMBED_BATCH_SIZE, texts.length)} ` +
            `(attempt ${attempt}/${EMBED_MAX_RETRIES}):`
        );
        console.error(err);

        const serverDelayMs = parseRetryDelayMs(err);
        const backoffMs = EMBED_BASE_DELAY_MS * attempt;
        const waitMs = Math.max(serverDelayMs ?? 0, backoffMs);

        console.log(
          `\nRate limit hit while embedding batch ${i + 1}-${Math.min(i + EMBED_BATCH_SIZE, texts.length)}. ` +
            `Retry ${attempt}/${EMBED_MAX_RETRIES} in ${Math.ceil(waitMs / 1000)}s ...`
        );
        await sleep(waitMs);
      }
    }

    if (!result) {
      throw new Error("Failed to embed batch after retries.");
    }

    const values = result.embeddings?.map((e) => e.values ?? []) ?? [];
    allEmbeddings.push(...values);
  }

  process.stdout.write("\n");
  return allEmbeddings;
}

// ─── ID helpers ──────────────────────────────────────────────────────────────

/**
 * Converts a deterministic string key (e.g. "nft_42") into a UUID string
 * using MD5 so Qdrant point IDs are stable across re-runs.
 */
function toUUID(key: string): string {
  const h = createHash("md5").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// ─── Chunk builders ──────────────────────────────────────────────────────────

async function buildNFTChunks(): Promise<Chunk[]> {
  const nfts = await prisma.nFT.findMany({
    where: { moderationStatus: { not: "DELISTED" } },
    include: {
      creator: { select: { id: true, name: true, walletAddress: true } },
      owner: { select: { id: true, name: true, walletAddress: true } },
      _count: { select: { likes: true } },
      auction: {
        select: {
          id: true,
          settled: true,
          frozen: true,
          startTime: true,
          endTime: true,
          minBid: true,
          highestBid: true,
        },
      },
    },
    orderBy: { id: "asc" },
  });

  const now = new Date();

  return nfts.map((nft) => {
    const a = nft.auction;
    let auctionStatus = "not listed";
    if (nft.isListed && !a) auctionStatus = "listed for direct sale";
    if (a) {
      if (a.settled) auctionStatus = "auction settled (sold)";
      else if (a.frozen) auctionStatus = "auction frozen by admin";
      else if (new Date(a.endTime) < now) auctionStatus = "auction ended (pending settlement)";
      else auctionStatus = `active auction — ends ${a.endTime.toISOString().split("T")[0]}`;
    }

    const lines = [
      `NFT title: "${nft.title}"`,
      nft.name !== nft.title ? `NFT name: "${nft.name}"` : "",
      `Description: ${nft.description}`,
      `Token ID: ${nft.tokenId}`,
      `File type: ${nft.fileType || "unknown"}`,
      `Creator: ${nft.creator.name} (wallet ${nft.creator.walletAddress})`,
      `Current owner: ${nft.owner.name} (wallet ${nft.owner.walletAddress})`,
      `Mint price: ${nft.mintPrice} ETH`,
      `Royalty: ${nft.royaltyBps / 100}%`,
      `Likes: ${nft._count.likes}`,
      `Marketplace status: ${auctionStatus}`,
      nft.moderationStatus !== "ACTIVE"
        ? `Moderation: ${nft.moderationStatus}${nft.moderationReason ? ` — ${nft.moderationReason}` : ""}`
        : "",
      `Minted: ${nft.createdAt.toISOString().split("T")[0]}`,
      a ? `Auction ID: ${a.id}, minimum bid: ${a.minBid} ETH` : "",
      a?.highestBid ? `Current highest bid: ${a.highestBid} ETH` : "",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      id: `nft_${nft.id}`,
      type: "nft",
      text: lines,
      payload: {
        chunk_type: "nft",
        nft_id: nft.id,
        token_id: nft.tokenId,
        title: nft.title,
        name: nft.name,
        creator_id: nft.creatorId,
        creator_name: nft.creator.name,
        creator_wallet: nft.creator.walletAddress,
        owner_id: nft.ownerId,
        owner_name: nft.owner.name,
        mint_price_eth: nft.mintPrice,
        royalty_bps: nft.royaltyBps,
        likes_count: nft._count.likes,
        is_listed: nft.isListed,
        file_type: nft.fileType,
        moderation_status: nft.moderationStatus,
        has_auction: !!a,
        auction_id: a?.id ?? null,
        created_at: nft.createdAt.toISOString(),
      },
    };
  });
}

async function buildAuctionChunks(): Promise<Chunk[]> {
  const auctions = await prisma.auction.findMany({
    include: {
      nft: {
        select: {
          id: true,
          name: true,
          title: true,
          description: true,
          fileType: true,
          mintPrice: true,
        },
      },
      seller: { select: { id: true, name: true, walletAddress: true } },
      highestBidder: { select: { id: true, name: true, walletAddress: true } },
      _count: { select: { bids: true } },
    },
    orderBy: { id: "asc" },
  });

  const now = new Date();

  return auctions.map((auction) => {
    const isActive =
      !auction.settled && !auction.frozen && new Date(auction.endTime) > now;
    const hasEnded = new Date(auction.endTime) < now;

    let statusText: string;
    if (auction.settled) statusText = "Settled — NFT has been transferred to the winner.";
    else if (auction.frozen) statusText = `Frozen by admin at ${auction.frozenAt?.toISOString().split("T")[0]}.`;
    else if (isActive) {
      const msLeft = new Date(auction.endTime).getTime() - now.getTime();
      const hoursLeft = Math.round(msLeft / 3_600_000);
      statusText = `Active — ends in ~${hoursLeft} hour${hoursLeft !== 1 ? "s" : ""} (${auction.endTime.toISOString().split("T")[0]}).`;
    } else if (hasEnded) statusText = "Ended — awaiting settlement.";
    else statusText = "Unknown status.";

    const lines = [
      `Auction for NFT: "${auction.nft.title}" (NFT ID ${auction.nft.id})`,
      `NFT description: ${auction.nft.description}`,
      `Auction ID: ${auction.id}`,
      `Status: ${statusText}`,
      `Seller: ${auction.seller.name} (wallet ${auction.seller.walletAddress})`,
      `Minimum bid: ${auction.minBid} ETH`,
      auction.highestBid
        ? `Highest bid so far: ${auction.highestBid} ETH by ${auction.highestBidder?.name ?? "unknown"}`
        : "No bids placed yet.",
      `Total bids received: ${auction._count.bids}`,
      `Auction start: ${auction.startTime.toISOString().split("T")[0]}`,
      `Auction end: ${auction.endTime.toISOString().split("T")[0]}`,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      id: `auction_${auction.id}`,
      type: "auction",
      text: lines,
      payload: {
        chunk_type: "auction",
        auction_id: auction.id,
        nft_id: auction.nftId,
        nft_title: auction.nft.title,
        seller_id: auction.sellerId,
        seller_name: auction.seller.name,
        min_bid_eth: auction.minBid,
        highest_bid_eth: auction.highestBid ?? null,
        highest_bidder_id: auction.highestBidderId ?? null,
        highest_bidder_name: auction.highestBidder?.name ?? null,
        bid_count: auction._count.bids,
        start_time: auction.startTime.toISOString(),
        end_time: auction.endTime.toISOString(),
        settled: auction.settled,
        frozen: auction.frozen,
        is_active: isActive,
      },
    };
  });
}

async function buildBidSummaryChunks(): Promise<Chunk[]> {
  // Only build a summary chunk if the auction actually has bids
  const auctions = await prisma.auction.findMany({
    where: { bids: { some: {} } },
    include: {
      nft: { select: { id: true, title: true } },
      bids: {
        include: {
          bidder: { select: { id: true, name: true, walletAddress: true } },
        },
        orderBy: { amount: "desc" },
      },
    },
    orderBy: { id: "asc" },
  });

  return auctions.map((auction) => {
    const amounts = auction.bids.map((b) => b.amount);
    const minAmount = Math.min(...amounts);
    const maxAmount = Math.max(...amounts);

    // Top 5 bids (already sorted by amount desc)
    const topBidsText = auction.bids
      .slice(0, 5)
      .map((b, i) => `  ${i + 1}. ${b.bidder.name}: ${b.amount} ETH`)
      .join("\n");

    // Bidding activity window
    const sortedByTime = [...auction.bids].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );
    const firstBid = sortedByTime[0];
    const lastBid = sortedByTime[sortedByTime.length - 1];

    const uniqueBidderIds = new Set(auction.bids.map((b) => b.bidderId));

    // Per-bidder activity summary (useful for "who bid the most" queries)
    const bidderActivity = Object.entries(
      auction.bids.reduce<Record<string, { name: string; count: number; maxBid: number }>>(
        (acc, b) => {
          if (!acc[b.bidderId]) {
            acc[b.bidderId] = { name: b.bidder.name, count: 0, maxBid: 0 };
          }
          acc[b.bidderId].count++;
          acc[b.bidderId].maxBid = Math.max(acc[b.bidderId].maxBid, b.amount);
          return acc;
        },
        {}
      )
    )
      .sort((a, b) => b[1].maxBid - a[1].maxBid)
      .slice(0, 5)
      .map(([, v]) => `  ${v.name}: ${v.count} bid(s), highest: ${v.maxBid} ETH`)
      .join("\n");

    const lines = [
      `Bid history summary for auction of NFT: "${auction.nft.title}" (Auction ID ${auction.id})`,
      `Total bids: ${auction.bids.length}`,
      `Bid range: ${minAmount} ETH (lowest) to ${maxAmount} ETH (highest)`,
      `Unique bidders: ${uniqueBidderIds.size}`,
      `Top bids by amount:\n${topBidsText}`,
      `Bidder activity (top 5 by highest bid):\n${bidderActivity}`,
      `First bid: ${firstBid.amount} ETH by ${firstBid.bidder.name} on ${firstBid.createdAt.toISOString().split("T")[0]}`,
      `Latest bid: ${lastBid.amount} ETH by ${lastBid.bidder.name} on ${lastBid.createdAt.toISOString().split("T")[0]}`,
    ].join("\n");

    return {
      id: `bid_summary_${auction.id}`,
      type: "bid_summary",
      text: lines,
      payload: {
        chunk_type: "bid_summary",
        auction_id: auction.id,
        nft_id: auction.nftId,
        nft_title: auction.nft.title,
        total_bids: auction.bids.length,
        min_bid_placed_eth: minAmount,
        max_bid_placed_eth: maxAmount,
        unique_bidders: uniqueBidderIds.size,
        first_bid_time: firstBid.createdAt.toISOString(),
        last_bid_time: lastBid.createdAt.toISOString(),
      },
    };
  });
}

// ─── Qdrant helpers ──────────────────────────────────────────────────────────

function getCollectionVectorSize(collectionInfo: unknown): number | null {
  const vectors = (collectionInfo as { config?: { params?: { vectors?: unknown } } })
    ?.config?.params?.vectors;
  if (!vectors || typeof vectors !== "object") return null;

  // Single-vector collections expose vectors as { size, distance }.
  const singleSize = (vectors as { size?: number }).size;
  if (typeof singleSize === "number") return singleSize;

  // Named-vector collections expose vectors as a record of vector configs.
  for (const value of Object.values(vectors as Record<string, { size?: number }>)) {
    if (value && typeof value.size === "number") return value.size;
  }

  return null;
}

async function ensureCollection(recreate: boolean): Promise<void> {
  const { collections } = await qdrant.getCollections();
  const exists = collections.some((c) => c.name === COLLECTION_NAME);

  let shouldRecreate = recreate;

  if (exists && !recreate) {
    const info = await qdrant.getCollection(COLLECTION_NAME);
    const existingDim = getCollectionVectorSize(info);
    if (existingDim !== null && existingDim !== VECTOR_SIZE) {
      console.warn(
        `Collection "${COLLECTION_NAME}" has dim=${existingDim}, but current embedding model outputs dim=${VECTOR_SIZE}. Recreating collection ...`
      );
      shouldRecreate = true;
    }
  }

  if (exists && shouldRecreate) {
    console.log(`Dropping existing collection "${COLLECTION_NAME}" ...`);
    await qdrant.deleteCollection(COLLECTION_NAME);
  }

  if (!exists || shouldRecreate) {
    console.log(`Creating collection "${COLLECTION_NAME}" (dim=${VECTOR_SIZE}, Cosine) ...`);
    await qdrant.createCollection(COLLECTION_NAME, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
    });

    // Payload indexes for fast filtering
    await qdrant.createPayloadIndex(COLLECTION_NAME, {
      field_name: "chunk_type",
      field_schema: "keyword",
    });
    await qdrant.createPayloadIndex(COLLECTION_NAME, {
      field_name: "nft_id",
      field_schema: "integer",
    });
    await qdrant.createPayloadIndex(COLLECTION_NAME, {
      field_name: "auction_id",
      field_schema: "integer",
    });
    await qdrant.createPayloadIndex(COLLECTION_NAME, {
      field_name: "is_active",
      field_schema: "bool",
    });
    await qdrant.createPayloadIndex(COLLECTION_NAME, {
      field_name: "settled",
      field_schema: "bool",
    });
    await qdrant.createPayloadIndex(COLLECTION_NAME, {
      field_name: "mint_price_eth",
      field_schema: "float",
    });
    await qdrant.createPayloadIndex(COLLECTION_NAME, {
      field_name: "min_bid_eth",
      field_schema: "float",
    });
  } else {
    console.log(`Collection "${COLLECTION_NAME}" already exists, upserting ...`);
  }
}

async function upsertChunks(chunks: Chunk[], embeddings: number[][]): Promise<void> {
  for (let i = 0; i < chunks.length; i += QDRANT_UPSERT_BATCH) {
    const batchChunks = chunks.slice(i, i + QDRANT_UPSERT_BATCH);
    const batchEmbeds = embeddings.slice(i, i + QDRANT_UPSERT_BATCH);

    await qdrant.upsert(COLLECTION_NAME, {
      wait: true,
      points: batchChunks.map((chunk, idx) => ({
        id: toUUID(chunk.id),
        vector: batchEmbeds[idx],
        payload: {
          ...chunk.payload,
          text: chunk.text, // store raw text so RAG can retrieve it
        },
      })),
    });
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const recreate = process.argv.includes("--recreate");

  console.log("=== ApolloNFT → Qdrant Vector DB Seeder ===\n");

  // 1. Build chunks
  console.log("Fetching data from database ...");
  const [nftChunks, auctionChunks, bidSummaryChunks] = await Promise.all([
    buildNFTChunks(),
    buildAuctionChunks(),
    buildBidSummaryChunks(),
  ]);

  const allChunks = [...nftChunks, ...auctionChunks, ...bidSummaryChunks];
  console.log(
    `Chunks: ${allChunks.length} total — ` +
      `NFTs: ${nftChunks.length}, Auctions: ${auctionChunks.length}, Bid summaries: ${bidSummaryChunks.length}\n`
  );

  if (allChunks.length === 0) {
    console.log("No data found in database. Exiting.");
    return;
  }

  // 2. Ensure Qdrant collection
  await ensureCollection(recreate);

  // 3. Generate embeddings
  console.log(`Generating embeddings with Gemini ${EMBEDDING_MODEL} ...`);
  const allTexts = allChunks.map((c) => c.text);
  const embeddings = await embedTexts(allTexts);
  console.log(`Generated ${embeddings.length} embeddings.\n`);

  // 4. Upsert into Qdrant
  console.log("Upserting into Qdrant ...");
  await upsertChunks(allChunks, embeddings);

  const info = await qdrant.getCollection(COLLECTION_NAME);
  console.log(
    `\nDone! Collection "${COLLECTION_NAME}" now has ${info.points_count ?? "?"} points.`
  );
}

main()
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
