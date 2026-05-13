import express, { Response } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";

const router = express.Router();

router.use(requireAuth);

// GET /api/pieces/:id
// Returns a single piece with its analysis and improv suggestions
router.get("/:id", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const piece = await prisma.piece.findUnique({
      where: { id: req.params.id as string },
      include: {
        analysis: true,
        improvSuggestions: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!piece) {
      res.status(404).json({ error: "Piece not found" });
      return;
    }

    res.json({ piece });
  } catch (error) {
    console.error("Get piece error:", error);
    res.status(500).json({ error: "Failed to load piece" });
  }
});

export default router;