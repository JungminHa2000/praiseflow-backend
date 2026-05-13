import express, { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import bcrypt from "bcrypt";

const router = express.Router();

// This route creates a test user and folder so we can test uploads.
// We will remove this before the app goes live.
router.post("/seed", async (req: Request, res: Response) => {
  try {
    // Create a test user
    const user = await prisma.user.create({
      data: {
        name: "Test User",
        email: "test@praiseflow.com",
        passwordHash: await bcrypt.hash("password123", 10),
        instrumentDefault: "keyboard",
      },
    });

    // Create a test folder belonging to that user
    const folder = await prisma.folder.create({
      data: {
        name: "Sunday Sets",
        userId: user.id,
      },
    });

    res.status(201).json({
      message: "Seed data created",
      userId: user.id,
      folderId: folder.id,
    });
  } catch (error) {
    console.error("Seed error:", error);
    res.status(500).json({ error: "Seed failed" });
  }
});

export default router;