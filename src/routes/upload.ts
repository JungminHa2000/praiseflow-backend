import express, { Request, Response } from "express";
import multer from "multer";
import sharp from "sharp";
import path from "path";
import fs from "fs";
import { prisma } from "../lib/prisma";

const router = express.Router();

// -- MULTER SETUP --
// Multer handles incoming file uploads. We configure it to save
// files to the /uploads folder with a unique timestamped filename
// so two files with the same name never overwrite each other.
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

// Only allow image and PDF file types
const fileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only JPEG, PNG, WebP and PDF files are allowed"));
  }
};

const upload = multer({ storage, fileFilter });

// -- UPLOAD ENDPOINT --
// POST /api/upload
// Accepts a file and a title, pre-processes images with Sharp,
// and creates a Piece record in the database.
router.post("/", upload.single("file"), async (req: Request, res: Response) => {
  try {
    // Check a file was actually attached to the request
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const { title, folderId } = req.body;

    if (!title || !folderId) {
      res.status(400).json({ error: "Title and folderId are required" });
      return;
    }

    let finalFilePath = req.file.path;
    const isImage = req.file.mimetype.startsWith("image/");

    // -- IMAGE PRE-PROCESSING WITH SHARP --
    // If the uploaded file is an image (not a PDF), we clean it up
    // before sending to Claude. This helps with blurry or low-contrast
    // phone photos of sheet music.
    if (isImage) {
      const processedPath = `uploads/processed-${Date.now()}-${req.file.originalname}`;

      await sharp(req.file.path)
        .grayscale()        // convert to black and white — removes colour noise
        .normalise()        // auto-adjusts contrast so ink pops against the page
        .sharpen()          // sharpens edges — helps with slightly blurry photos
        .toFile(processedPath);

      // Delete the original unprocessed file to save disk space
      fs.unlinkSync(req.file.path);
      finalFilePath = processedPath;
    }

    // -- SAVE TO DATABASE --
    // Create a Piece record in Postgres via Prisma.
    // processingStatus starts as "pending" — it will change to
    // "processing" when we send it to Claude, then "ready" when done.
    const piece = await prisma.piece.create({
      data: {
        title,
        folderId,
        fileUrl: finalFilePath,
        fileType: req.file.mimetype,
        processingStatus: "pending",
      },
    });

    res.status(201).json({
      message: "File uploaded successfully",
      piece,
    });
  } catch (error) {
    console.error("Upload error:", JSON.stringify(error, null, 2));
if (error instanceof Error) {
  console.error("Error message:", error.message);
  console.error("Error stack:", error.stack);
}

    res.status(500).json({ error: "Upload failed" });
  }
});

export default router;