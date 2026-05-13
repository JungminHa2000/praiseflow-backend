import express, { Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import { prisma } from "../lib/prisma";

const router = express.Router();

const anthropic = new Anthropic();

router.post("/", async (req: Request, res: Response) => {
  try {
    const { pieceId } = req.body;

    if (!pieceId) {
      res.status(400).json({ error: "pieceId is required" });
      return;
    }

    const piece = await prisma.piece.findUnique({
      where: { id: pieceId },
    });

    if (!piece) {
      res.status(404).json({ error: "Piece not found" });
      return;
    }

    await prisma.piece.update({
      where: { id: pieceId },
      data: { processingStatus: "processing" },
    });

    const fileBuffer = fs.readFileSync(piece.fileUrl);
    const base64File = fileBuffer.toString("base64");

    const isPdf = piece.fileType === "application/pdf";

    const fileContentBlock = isPdf
      ? {
          type: "document" as const,
          source: {
            type: "base64" as const,
            media_type: "application/pdf" as const,
            data: base64File,
          },
        }
      : {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: piece.fileType as "image/jpeg" | "image/png" | "image/webp",
            data: base64File,
          },
        };

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: [
            fileContentBlock,
            {
              type: "text",
              text: `You are an expert music theorist and worship musician.
Analyse this sheet music or chord chart carefully.

Return ONLY a valid JSON object with NO extra text, markdown, or explanation.
IMPORTANT: Do NOT include any song lyrics in your response. Only describe the song's structure, chord progression, and musical elements. Skip lyrics entirely.

MELODY EXTRACTION (lead sheets and staff notation ONLY):
If this is a lead sheet or staff notation where melody notes are visually written on the staff, you MUST extract every single melody note. Add a "melodyNotes" field to your JSON with this structure:
"melodyNotes": [
  { "note": "D4", "duration": "q", "beats": 1, "bar": 1, "beat": 1 },
  { "note": "E4", "duration": "q", "beats": 1, "bar": 1, "beat": 2 },
  { "note": "F#4", "duration": "h", "beats": 2, "bar": 1, "beat": 3 }
]
Rules for melody extraction:
- Read EVERY note from the staff — do not skip or summarise
- "note" must be the exact pitch with octave (e.g. "D4", "F#5", "Bb3")
- "duration" uses: "w" (whole), "h" (half), "q" (quarter), "8" (eighth), "16" (sixteenth)
- "beats" is the numeric beat value (4, 2, 1, 0.5, 0.25)
- "bar" is the measure number starting from 1
- "beat" is which beat within the measure the note starts on
- Include rests as { "note": "rest", "duration": "q", "beats": 1, "bar": 1, "beat": 4 }
- If this is a chord chart with NO staff notation, set "melodyNotes" to null
The JSON must follow this exact structure:

{
  "chartType": "chord_chart" or "staff_notation" or "lead_sheet",
  "songTitle": "the title of the song as shown on the page, or your best guess from the chords if not shown, or null if you genuinely cannot tell",
  "melodyRecognised": true or false (set to TRUE only if either: (a) this is a lead sheet or staff notation that visually contains melody notes, OR (b) you are highly confident you know the standard melody of this song from your training data and could write out the notes accurately. Set to FALSE if it's a chord chart for a song you do not recognise.),
  "keySignature": "e.g. G major, E minor, Bb major",
  "timeSignature": "e.g. 4/4, 3/4",
  "tempo": "e.g. 72 bpm, Moderately, With energy (or null if not marked)",
  "structureSections": [
    { "name": "Verse 1", "barCount": 8 },
    { "name": "Chorus", "barCount": 8 }
  ],
  IMPORTANT for structureSections:
  - Use the EXACT section labels written on the page (e.g. "Verse 1", "Chorus 1b", "Bridge", "Tag", "Interlude", "Instrumental")
  - If the chart says "Bridge" do not relabel it "Interlude" or vice versa
  - Include EVERY section that appears on the page in order, including repeats labelled differently (e.g. "Chorus 1", "Chorus 1b", "Chorus 2")
  - Do not merge or skip sections

 "chordProgression": [
    { "section": "Verse 1", "order": 1, "chord": "G" },
    { "section": "Verse 1", "order": 2, "chord": "Cadd9" },
    { "section": "Chorus", "order": 1, "chord": "Em7" }
  ],
  IMPORTANT for chordProgression:
  - The "section" field MUST match exactly one of the names in structureSections
  - Include every chord change in every section, even if sections repeat with the same chords

  "leadNotes": null,
  "confidenceLevel": "high" or "medium" or "low",
  "warnings": ["list any sections that were unclear or hard to read"]
}`,
            },
          ],
        },
      ],
    });

    const rawResponse = message.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { type: "text"; text: string }).text)
      .join("");

    const cleanedResponse = rawResponse
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const analysisData = JSON.parse(cleanedResponse);

    const analysis = await prisma.analysis.create({
        data: {
          pieceId,
          chartType: analysisData.chartType,
          songTitle: analysisData.songTitle || null,
          melodyRecognised: analysisData.melodyRecognised === true,
          keySignature: analysisData.keySignature,
          timeSignature: analysisData.timeSignature,
          tempo: analysisData.tempo,
          structureSections: analysisData.structureSections,
          chordProgression: analysisData.chordProgression,
          leadNotes: analysisData.melodyNotes || analysisData.leadNotes || null,
          confidenceLevel: analysisData.confidenceLevel,
          warnings: analysisData.warnings,
          rawClaudeResponse: rawResponse,
        },
      });

    await prisma.piece.update({
      where: { id: pieceId },
      data: { processingStatus: "ready" },
    });

    res.status(201).json({
      message: "Analysis complete",
      analysis,
    });
  } catch (error) {
    console.error("Analysis error:", error);
    if (error instanceof Error) {
      console.error("Error message:", error.message);
    }

    if (req.body.pieceId) {
      await prisma.piece.update({
        where: { id: req.body.pieceId },
        data: {
          processingStatus: "error",
          processingError:
            error instanceof Error ? error.message : "Unknown error",
        },
      });
    }

    res.status(500).json({ error: "Analysis failed" });
  }
});

export default router;