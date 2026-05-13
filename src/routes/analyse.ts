import express, { Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import { prisma } from "../lib/prisma";

const SHARP_KEYS: Record<string, string[]> = {
    "C major": [],
    "G major": ["F#"],
    "D major": ["F#", "C#"],
    "A major": ["F#", "C#", "G#"],
    "E major": ["F#", "C#", "G#", "D#"],
    "B major": ["F#", "C#", "G#", "D#", "A#"],
  };
  
  const FLAT_KEYS: Record<string, string[]> = {
    "F major": ["Bb"],
    "Bb major": ["Bb", "Eb"],
    "Eb major": ["Bb", "Eb", "Ab"],
    "Ab major": ["Bb", "Eb", "Ab", "Db"],
  };
  
  const MINOR_KEYS: Record<string, string[]> = {
    "A minor": [],
    "E minor": ["F#"],
    "B minor": ["F#", "C#"],
    "D minor": ["Bb"],
    "G minor": ["Bb", "Eb"],
    "C minor": ["Bb", "Eb", "Ab"],
  };

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

      // -- SECOND PASS: Extract melody notes for lead sheets --
// If the chart type is a lead sheet, make a focused second call
// to extract just the melody notes measure by measure
if (analysisData.chartType === "lead_sheet" || analysisData.chartType === "staff_notation") {
    try {
      const melodyMessage = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 16000,
        messages: [
          {
            role: "user",
            content: [
              fileContentBlock,
              {
                type: "text",
                text: `You are reading sheet music notation. Focus ONLY on extracting the melody notes from the staff.
  
  The key signature is ${analysisData.keySignature || "unknown"}.
  The time signature is ${analysisData.timeSignature || "4/4"}.
  
  TASK: Read each measure left to right, top staff only (melody line). For each note:
  1. Identify which line or space it sits on
  2. Apply the key signature (e.g. in G major, all F notes are F#)
  3. Look for accidentals directly before the note
  4. Determine the duration from the note head and stem (filled head + stem = quarter, open head + stem = half, open head no stem = whole, filled head + stem + flag = eighth)
  5. Note any dots (adds 50% to duration)
  6. Note any rests
  
  Read VERY carefully. Take your time with each measure. If a note is ambiguous, flag it.
  
  Return ONLY valid JSON with no extra text:
  
  {
    "melodyNotes": [
      { "bar": 1, "beat": 1, "note": "D4", "duration": "q", "beats": 1 },
      { "bar": 1, "beat": 2, "note": "E4", "duration": "q", "beats": 1 },
      { "bar": 1, "beat": 3, "note": "F#4", "duration": "h", "beats": 2 }
    ],
    "uncertainNotes": [
      { "bar": 3, "beat": 2, "note": "B4", "reason": "Could be B4 or C5, note sits between line and space" }
    ]
  }`,
              },
            ],
          },
        ],
      });
  
      const melodyRaw = melodyMessage.content
        .filter((block) => block.type === "text")
        .map((block) => (block as { type: "text"; text: string }).text)
        .join("");
  
      const melodyCleaned = melodyRaw
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();
  
      const melodyData = JSON.parse(melodyCleaned);
  
      // Validate notes against key signature
      const keyAccidentals = {
        ...SHARP_KEYS,
        ...FLAT_KEYS,
        ...MINOR_KEYS,
      }[analysisData.keySignature || "C major"] || [];
  
      if (melodyData.melodyNotes && Array.isArray(melodyData.melodyNotes)) {
        // Auto-correct notes that don't match the key signature
        melodyData.melodyNotes = melodyData.melodyNotes.map((n: any) => {
          if (!n.note || n.note === "rest") return n;
  
          const noteName = n.note.match(/^([A-G][#b]?)/)?.[1];
          const octave = n.note.match(/(\d)$/)?.[1];
  
          if (noteName && octave) {
            // Check if this note should have an accidental from the key
            const naturalNote = noteName.replace(/[#b]/, "");
            const shouldBeSharp = keyAccidentals.find(
              (a) => a.replace("#", "").replace("b", "") === naturalNote
            );
  
            if (shouldBeSharp && !noteName.includes("#") && !noteName.includes("b")) {
              // Note is missing its key signature accidental
              n.note = shouldBeSharp + octave;
              n.corrected = true;
              n.originalNote = noteName + octave;
            }
          }
  
          return n;
        });
      }
  
      // Update the analysis with the extracted melody notes
      await prisma.analysis.update({
        where: { id: analysis.id },
        data: {
          leadNotes: melodyData.melodyNotes || null,
          warnings: [
            ...((analysisData.warnings as any[]) || []),
            ...(melodyData.uncertainNotes || []).map(
              (u: any) => `Bar ${u.bar}, beat ${u.beat}: ${u.reason}`
            ),
          ],
        },
      });
    } catch (melodyError) {
      console.error("Melody extraction failed (non-fatal):", melodyError);
      // Don't fail the whole analysis if melody extraction fails
    }
  }

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