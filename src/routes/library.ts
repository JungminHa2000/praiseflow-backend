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

// -- GET ALL PIECES (flat list) --
// GET /api/library/all-songs
// Returns every piece the user has, regardless of folder
router.get("/all-songs", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const pieces = await prisma.piece.findMany({
        where: {
          folder: {
            userId: req.userId,
          },
        },
        include: {
          analysis: true,
          folder: true,
        },
        orderBy: { createdAt: "desc" },
      });
  
      res.json({ pieces });
    } catch (error) {
      console.error("All songs error:", error);
      res.status(500).json({ error: "Failed to load songs" });
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

// -- RENAME A PIECE --
// PATCH /api/library/pieces/:id/rename
router.patch("/pieces/:id/rename", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { title } = req.body;
  
      if (!title) {
        res.status(400).json({ error: "Title is required" });
        return;
      }
  
      const piece = await prisma.piece.update({
        where: { id: req.params.id as string },
        data: { title },
      });
  
      res.json({ piece });
    } catch (error) {
      console.error("Rename piece error:", error);
      res.status(500).json({ error: "Failed to rename piece" });
    }
  });
// -- DELETE A PIECE --
// DELETE /api/library/pieces/:id
router.delete("/pieces/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
      await prisma.piece.delete({
        where: { id: req.params.id as string },
      });
  
      res.json({ message: "Piece deleted" });
    } catch (error) {
      console.error("Delete piece error:", error);
      res.status(500).json({ error: "Failed to delete piece" });
    }
  });
  // -- MOVE A PIECE TO ANOTHER FOLDER --
// PATCH /api/library/pieces/:id/move
router.patch("/pieces/:id/move", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { targetFolderId } = req.body;
  
      if (!targetFolderId) {
        res.status(400).json({ error: "targetFolderId is required" });
        return;
      }
  
      const piece = await prisma.piece.update({
        where: { id: req.params.id as string },
        data: { folderId: targetFolderId },
        include: { analysis: true },
      });
  
      res.json({ message: "Piece moved", piece });
    } catch (error) {
      console.error("Move piece error:", error);
      res.status(500).json({ error: "Failed to move piece" });
    }
  });
  
  // -- COPY A PIECE TO ANOTHER FOLDER --
  // POST /api/library/pieces/:id/copy
  router.post("/pieces/:id/copy", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { targetFolderId } = req.body;
  
      if (!targetFolderId) {
        res.status(400).json({ error: "targetFolderId is required" });
        return;
      }
  
      // Load the original piece with all its related data
      const original = await prisma.piece.findUnique({
        where: { id: req.params.id as string },
        include: {
          analysis: true,
          improvSuggestions: true,
        },
      });
  
      if (!original) {
        res.status(404).json({ error: "Piece not found" });
        return;
      }
  
      // Create a copy of the piece in the target folder
      const copy = await prisma.piece.create({
        data: {
          title: `${original.title} (copy)`,
          fileUrl: original.fileUrl,
          fileType: original.fileType,
          processingStatus: original.processingStatus,
          folderId: targetFolderId,
        },
      });
  
      // Copy the analysis if it exists
      if (original.analysis) {
        await prisma.analysis.create({
          data: {
            pieceId: copy.id,
            keySignature: original.analysis.keySignature,
            timeSignature: original.analysis.timeSignature,
            chartType: original.analysis.chartType,
            songTitle: original.analysis.songTitle,
            melodyRecognised: original.analysis.melodyRecognised,
            chordProgression: original.analysis.chordProgression as any,
            structureSections: original.analysis.structureSections as any,
            leadNotes: original.analysis.leadNotes as any,
            tempo: original.analysis.tempo,
            confidenceLevel: original.analysis.confidenceLevel,
            warnings: original.analysis.warnings as any,
            rawClaudeResponse: original.analysis.rawClaudeResponse,
          },
        });
      }
  
      // Copy all improv suggestions
      for (const improv of original.improvSuggestions) {
        await prisma.improvSuggestion.create({
          data: {
            pieceId: copy.id,
            instrument: improv.instrument,
            voiceType: improv.voiceType,
            style: improv.style,
            suggestions: improv.suggestions as any,
            pdfUrl: improv.pdfUrl,
            title: improv.title,
          },
        });
      }
  
      // Load the complete copy to return
      const completeCopy = await prisma.piece.findUnique({
        where: { id: copy.id },
        include: { analysis: true },
      });
  
      res.status(201).json({ message: "Piece copied", piece: completeCopy });
    } catch (error) {
      console.error("Copy piece error:", error);
      res.status(500).json({ error: "Failed to copy piece" });
    }
  });
// -- DELETE AN IMPROV SUGGESTION --
// DELETE /api/library/improvs/:id
router.delete("/improvs/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
      await prisma.improvSuggestion.delete({
        where: { id: req.params.id as string },
      });
      res.json({ message: "Generation deleted" });
    } catch (error) {
      console.error("Delete improv error:", error);
      res.status(500).json({ error: "Failed to delete generation" });
    }
  });
  
  // -- BULK DELETE IMPROV SUGGESTIONS --
  // POST /api/library/improvs/bulk-delete
  router.post("/improvs/bulk-delete", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { ids } = req.body;
  
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: "ids array is required" });
        return;
      }
  
      await prisma.improvSuggestion.deleteMany({
        where: { id: { in: ids } },
      });
  
      res.json({ message: `${ids.length} generations deleted` });
    } catch (error) {
      console.error("Bulk delete improv error:", error);
      res.status(500).json({ error: "Failed to delete generations" });
    }
  });

export default router;