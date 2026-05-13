import express, { Response } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";

const router = express.Router();

// All library routes require authentication
router.use(requireAuth);

// -- GET ALL FOLDERS AND PIECES --
// GET /api/library
// Returns all folders and their pieces for the logged-in user
router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const folders = await prisma.folder.findMany({
      where: { userId: req.userId },
      include: {
        pieces: {
          include: {
            analysis: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    res.json({ folders });
  } catch (error) {
    console.error("Library error:", error);
    res.status(500).json({ error: "Failed to load library" });
  }
});

// -- CREATE A FOLDER --
// POST /api/library/folders
router.post("/folders", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, parentId } = req.body;

    if (!name) {
      res.status(400).json({ error: "Folder name is required" });
      return;
    }

    const folder = await prisma.folder.create({
      data: {
        name,
        userId: req.userId!,
        parentId: parentId || null,
      },
    });

    res.status(201).json({ folder });
  } catch (error) {
    console.error("Create folder error:", error);
    res.status(500).json({ error: "Failed to create folder" });
  }
});

// -- RENAME A FOLDER --
// PATCH /api/library/folders/:id
router.patch("/folders/:id", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name } = req.body;

    const folder = await prisma.folder.update({
      where: { id: req.params.id as string},
      data: { name },
    });

    res.json({ folder });
  } catch (error) {
    console.error("Rename folder error:", error);
    res.status(500).json({ error: "Failed to rename folder" });
  }
});

// -- DELETE A FOLDER --
// DELETE /api/library/folders/:id
router.delete("/folders/:id", async (req: AuthenticatedRequest, res: Response) => {
  try {
    await prisma.folder.delete({
      where: { id: req.params.id as string},
    });

    res.json({ message: "Folder deleted" });
  } catch (error) {
    console.error("Delete folder error:", error);
    res.status(500).json({ error: "Failed to delete folder" });
  }
});

export default router;