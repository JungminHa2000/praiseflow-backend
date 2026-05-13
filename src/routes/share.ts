import express, { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";

const router = express.Router();

// -- CREATE A SHARE LINK --
// POST /api/share
// Can share either a single piece OR an entire folder
router.post("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { pieceId, folderId } = req.body;

    if (!pieceId && !folderId) {
      res.status(400).json({ error: "Either pieceId or folderId is required" });
      return;
    }

    const shareLink = await prisma.shareLink.create({
      data: {
        pieceId: pieceId || null,
        folderId: folderId || null,
        userId: req.userId!,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const shareType = pieceId ? "piece" : "folder";

    res.status(201).json({
      message: `Share link created for ${shareType}`,
      shareLink: {
        token: shareLink.token,
        expiresAt: shareLink.expiresAt,
        type: shareType,
        url: `/shared/${shareLink.token}`,
      },
    });
  } catch (error) {
    console.error("Create share link error:", error);
    res.status(500).json({ error: "Failed to create share link" });
  }
});

// -- VIEW A SHARED ITEM --
// GET /api/share/:token
// No auth required. Returns either a piece or a folder with all its pieces.
router.get("/:token", async (req: Request, res: Response) => {
  try {
    const token = req.params.token as string;

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
        folder: {
          include: {
            pieces: {
              include: {
                analysis: true,
                improvSuggestions: {
                  orderBy: { createdAt: "desc" },
                },
              },
              orderBy: { createdAt: "desc" },
            },
          },
        },
      },
    });

    if (!shareLink) {
      res.status(404).json({ error: "Share link not found" });
      return;
    }

    if (!shareLink.isActive) {
      res.status(403).json({ error: "This share link has been deactivated" });
      return;
    }

    if (shareLink.expiresAt && shareLink.expiresAt < new Date()) {
      res.status(403).json({ error: "This share link has expired" });
      return;
    }

    // Return different shapes depending on what was shared
    if (shareLink.piece) {
      res.json({
        type: "piece",
        piece: shareLink.piece,
        expiresAt: shareLink.expiresAt,
      });
    } else if (shareLink.folder) {
      res.json({
        type: "folder",
        folder: shareLink.folder,
        expiresAt: shareLink.expiresAt,
      });
    } else {
      res.status(404).json({ error: "Shared content not found" });
    }
  } catch (error) {
    console.error("View shared item error:", error);
    res.status(500).json({ error: "Failed to load shared content" });
  }
});

export default router;