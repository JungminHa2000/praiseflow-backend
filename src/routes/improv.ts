import express, { Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../lib/prisma";

const router = express.Router();

const anthropic = new Anthropic();

// -- IMPROV ENDPOINT --
// POST /api/improv
// Takes a pieceId plus an instrument or voice type and asks Claude
// to generate improv suggestions based on the analysed chord progression.
router.post("/", async (req: Request, res: Response) => {
  try {
    const { pieceId, instrument, voiceType, style } = req.body;

    if (!pieceId) {
      res.status(400).json({ error: "pieceId is required" });
      return;
    }

    if (!instrument && !voiceType) {
      res.status(400).json({
        error: "Either instrument or voiceType is required",
      });
      return;
    }

    // Load the piece and its analysis from the database.
    // The `include: { analysis: true }` tells Prisma to also fetch
    // the related Analysis row in the same query.
    const piece = await prisma.piece.findUnique({
      where: { id: pieceId },
      include: { analysis: true },
    });

    if (!piece) {
      res.status(404).json({ error: "Piece not found" });
      return;
    }

    if (!piece.analysis) {
      res.status(400).json({
        error: "Piece has not been analysed yet. Call /api/analyse first.",
      });
      return;
    }

    const analysis = piece.analysis;
    const performerType = instrument || `${voiceType} vocals`;
    const musicalStyle = style || "contemporary worship";
    const isVocal = !!voiceType;

    // -- VOCAL HARMONY GATING --
    // If the user requested a vocal harmony but Claude couldn't
    // recognise the melody, we cannot generate accurate harmony notes.
    // Return a clear error asking for a lead sheet upload.
    if (isVocal && !analysis.melodyRecognised) {
      res.status(400).json({
        error: "Cannot generate vocal harmony for this song",
        reason:
          "To generate accurate note-by-note vocal harmonies, we need the melody. This appears to be a chord chart for a song the AI does not recognise. Please upload a lead sheet that includes the melody on a staff so we can build the harmony line against the actual melody notes.",
        suggestedAction: "upload_lead_sheet",
      });
      return;
    }

    // -- BUILD THE PROMPT --
    // Vocal and instrumental requests get different prompts because
    // the user expects different things: a vocalist needs exact notes
    // to sing, while an instrumentalist wants idiomatic fills and runs.
    let promptText: string;

    if (isVocal) {
      promptText = `You are an experienced worship music arranger specialising in vocal harmonies.

      Generate a complete note-by-note ${voiceType} harmony line for the song "${analysis.songTitle}".

      CRITICAL REQUIREMENTS:
      - Generate a harmony note for EVERY syllable of the lyrics, not a subset
      - Do not summarise or skip sections, even if sections repeat
      - For a song section with N syllables, your harmony must contain exactly N notes
      - Each syllable in the lyrics gets one entry in harmonyNotes
      - If unsure of a syllable's pitch, use the closest chord tone — never skip

      Song details:
      - Key: ${analysis.keySignature}
      - Time signature: ${analysis.timeSignature}
      - Tempo: ${analysis.tempo || "not specified"}
      - Structure: ${JSON.stringify(analysis.structureSections)}
      - Chord progression: ${JSON.stringify(analysis.chordProgression)}
      ${analysis.leadNotes && Array.isArray(analysis.leadNotes) ? `- ACTUAL MELODY NOTES (extracted from the lead sheet — use these as the source of truth): ${JSON.stringify(analysis.leadNotes)}` : `- Melody notes: not available from the uploaded chart. You must recall the melody from your knowledge of the song "${analysis.songTitle}".`}

      ${analysis.leadNotes && Array.isArray(analysis.leadNotes)
        ? `The actual melody notes are provided above — extracted directly from the uploaded lead sheet. Generate the ${voiceType} harmony by calculating the correct interval from EACH melody note. Do NOT guess or recall from memory — use the provided melody notes as your source of truth.
      
      For each melody note, calculate the harmony note:
      - Alto: typically a major or minor third below the melody note
      - Soprano: typically a third or fifth above
      - Tenor: typically a fifth below or third below
      - Bass: typically an octave below or on the root of the chord
      
      Use the actual chord context to decide whether the interval should be major or minor.`
        : `You must recall the standard melody of "${analysis.songTitle}" from your training data. Generate the ${voiceType} harmony part that sits naturally above or below the lead melody, using chord tones and traditional voice-leading.
      
      IMPORTANT: Since you are recalling the melody from memory, some notes may be approximate. Prioritise chord tones and smooth voice leading over exact interval matching.`
      }

Guidelines:
- Soprano harmonies usually sit a third or fifth above the melody.
- Alto harmonies typically sit a third below the melody or hold inner chord tones.
- Tenor harmonies sit below the melody, often on the fifth or octave.
- Bass harmonies move with the root or fifth of each chord.
- Avoid awkward leaps and respect voice-leading: prefer stepwise motion and small intervals.
- Account for each section's mood — verses are intimate, choruses build, bridges climax.

Return ONLY valid JSON in this exact format with no extra text or markdown:

{
  "performerType": "${voiceType} vocals",
  "songTitle": "${analysis.songTitle}",
  "style": "${musicalStyle}",
  "harmonyType": "vocal_part",
  "sections": [
    {
      "name": "Verse 1",
      "harmonyNotes": [
        { "order": 1, "chord": "E", "harmonyNote": "G#4", "intervalFromMelody": "third below", "syllableCue": "first syllable", "duration": "q", "beats": 1 },
        { "order": 2, "chord": "A2", "harmonyNote": "C#5", "intervalFromMelody": "third below", "syllableCue": "next syllable", "duration": "8", "beats": 0.5 }
      ],
      "performanceNote": "Sing gently, blending under the lead vocal"
    }
  ],
  CRITICAL REQUIREMENTS:
  - Generate a harmony note for EVERY syllable of the lyrics, not a subset
  - You MUST use ONLY the section names listed in the song's "Structure" above. Do not invent, add, or rename sections. If the structure says "Verse 1", "Chorus", "Bridge", you must produce sections named exactly "Verse 1", "Chorus", "Bridge" — not "Chorus 1A", not "Instrumental", not anything else
  - The order of your output sections must match the order in the structure
  - For each syllable, generate one entry in harmonyNotes with the correct rhythmic duration
  - If unsure of a syllable's pitch, use the closest chord tone — never skip
  - Duration values must be ONE of these exact strings: "w" (whole, 4 beats), "h" (half, 2 beats), "q" (quarter, 1 beat), "8" (eighth, 0.5 beats), "16" (sixteenth, 0.25 beats). Do NOT use dots or any other format
  - Also include "beats" as a number matching the duration (4, 2, 1, 0.5, or 0.25)
  - The total beats in each section should approximately match barCount × beats-per-bar
    }
  ],
  "generalAdvice": "1 to 2 sentences of overall guidance for performing this harmony"
}`;
    } else {
      promptText = `You are an experienced worship musician and arranger with deep knowledge of ${musicalStyle} style.

You are helping a ${performerType} player add tasteful improvisation and fills to a worship song to make their performance more dynamic and musical.

Here is the song analysis:
- Key: ${analysis.keySignature}
- Time signature: ${analysis.timeSignature}
- Tempo: ${analysis.tempo || "not specified"}
- Structure: ${JSON.stringify(analysis.structureSections)}
- Chord progression: ${JSON.stringify(analysis.chordProgression)}

Generate 6 to 10 specific improvisation suggestions tailored for ${performerType}.

For each suggestion, specify:
- Which section of the song it goes in
- What type of embellishment it is (fill, run, harmony, counter-melody, sustain, rhythmic figure)
- A clear description of what to play, using musical language the performer will understand
- The chord context it fits over
- A difficulty rating: beginner, intermediate, or advanced
- A short rationale explaining why this works musically

Mix difficulty levels so beginners and advanced players both get something useful.
Make suggestions idiomatic to ${performerType} — what a real worship ${performerType} player would actually play.

Return ONLY valid JSON in this exact format with no extra text or markdown:

{
  "performerType": "${performerType}",
  "style": "${musicalStyle}",
  "harmonyType": "instrument_improv",
  "suggestions": [
    {
      "section": "Verse 1",
      "type": "fill",
      "description": "Right hand ascending arpeggio E-G#-B-E over two beats on beat 4",
      "chordContext": "E major to A2",
      "difficulty": "beginner",
      "rationale": "Smoothly bridges the chord change and adds forward motion"
    }
  ],
  "generalAdvice": "1 to 2 sentences of overall guidance for performing this song"
}`;
    }

    // -- CALL CLAUDE --
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 16000,
      messages: [
        {
          role: "user",
          content: promptText,
        },
      ],
    });

    // Extract the text response from Claude
    const rawResponse = message.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { type: "text"; text: string }).text)
      .join("");

    // Strip any accidental markdown fences
    const cleanedResponse = rawResponse
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const improvData = JSON.parse(cleanedResponse);

    // Save to the database
    const improvSuggestion = await prisma.improvSuggestion.create({
      data: {
        pieceId,
        instrument: instrument || null,
        voiceType: voiceType || null,
        style: musicalStyle,
        suggestions: improvData,
      },
    });

    res.status(201).json({
      message: "Improv generated successfully",
      improvSuggestion,
    });
  } catch (error) {
    console.error("Improv error:", error);
    if (error instanceof Error) {
      console.error("Error message:", error.message);
    }
    res.status(500).json({ error: "Improv generation failed" });
  }
});

export default router;