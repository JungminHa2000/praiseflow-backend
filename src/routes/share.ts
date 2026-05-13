import express, { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";

const router = express.Router();

// -- CREATE A SHARE LINK --
// POST /api/share
// Requires authentication — only the song owner can create share links.
// Generates a unique token and returns a shareable URL.
router.post("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { pieceId } = req.body;

    if (!pieceId) {
      res.status(400).json({ error: "pieceId is required" });
      return;
    }

    // Verify the piece exists
    const piece = await prisma.piece.findUnique({
      where: { id: pieceId },
    });

    if (!piece) {
      res.status(404).json({ error: "Piece not found" });
      return;
    }

    // Create the share link. Prisma auto-generates a UUID token
    // because of @default(uuid()) in the schema.
    const shareLink = await prisma.shareLink.create({
      data: {
        pieceId,
        userId: req.userId!,
        // Expires in 30 days. Set to null for no expiry.
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    res.status(201).json({
      message: "Share link created",
      shareLink: {
        token: shareLink.token,
        expiresAt: shareLink.expiresAt,
        url: `/shared/${shareLink.token}`,
      },
    });
  } catch (error) {
    console.error("Create share link error:", error);
    res.status(500).json({ error: "Failed to create share link" });
  }
});

// -- VIEW A SHARED PIECE --
// GET /api/share/:token
// NO authentication required — anyone with the token can view.
// Returns the piece, its analysis, and any improv suggestions.
router.get("/:token", async (req: Request, res: Response) => {
  try {
    const token = req.params.token as string;

    // Find the share link by its unique token
    const shareLink = await prisma.shareLink.findUnique({
      where: { token },
      include: {
        piece: {
          include: {
            analysis: true,
            improvSuggestions: {
              orderBy: { createdAt: "desc" },
            },
          },
        },
      },
    });

    // Check if the link exists
    if (!shareLink) {
      res.status(404).json({ error: "Share link not found" });
      return;
    }

    // Check if the link has been deactivated
    if (!shareLink.isActive) {
      res.status(403).json({ error: "This share link has been deactivated" });
      return;
    }

    // Check if the link has expired
    if (shareLink.expiresAt && shareLink.expiresAt < new Date()) {
      res.status(403).json({ error: "This share link has expired" });
      return;
    }

    res.json({
      piece: shareLink.piece,
      sharedBy: shareLink.userId,
      expiresAt: shareLink.expiresAt,
    });
  } catch (error) {
    console.error("View shared piece error:", error);
    res.status(500).json({ error: "Failed to load shared piece" });
  }
});

export default router;