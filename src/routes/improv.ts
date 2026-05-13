import express, { Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../lib/prisma";

const router = express.Router();
const anthropic = new Anthropic();

// -- MUSIC THEORY HELPERS --
// These functions validate and correct notes based on key signature

const SHARP_KEYS: Record<string, string[]> = {
  "C major": [],
  "G major": ["F#"],
  "D major": ["F#", "C#"],
  "A major": ["F#", "C#", "G#"],
  "E major": ["F#", "C#", "G#", "D#"],
  "B major": ["F#", "C#", "G#", "D#", "A#"],
  "F# major": ["F#", "C#", "G#", "D#", "A#", "E#"],
};

const FLAT_KEYS: Record<string, string[]> = {
  "F major": ["Bb"],
  "Bb major": ["Bb", "Eb"],
  "Eb major": ["Bb", "Eb", "Ab"],
  "Ab major": ["Bb", "Eb", "Ab", "Db"],
  "Db major": ["Bb", "Eb", "Ab", "Db", "Gb"],
};

const MINOR_KEYS: Record<string, string[]> = {
  "A minor": [],
  "E minor": ["F#"],
  "B minor": ["F#", "C#"],
  "F# minor": ["F#", "C#", "G#"],
  "C# minor": ["F#", "C#", "G#", "D#"],
  "D minor": ["Bb"],
  "G minor": ["Bb", "Eb"],
  "C minor": ["Bb", "Eb", "Ab"],
  "F minor": ["Bb", "Eb", "Ab", "Db"],
};

// Get chord tones for a given chord symbol
function getChordTones(chord: string): string[] {
  // Strip bass note (e.g. "D/F#" -> "D")
  const root = chord.split("/")[0];

  // Common chord mappings
  const chordMap: Record<string, string[]> = {
    C: ["C", "E", "G"],
    "C#": ["C#", "F", "G#"],
    Db: ["Db", "F", "Ab"],
    D: ["D", "F#", "A"],
    Eb: ["Eb", "G", "Bb"],
    E: ["E", "G#", "B"],
    F: ["F", "A", "C"],
    "F#": ["F#", "A#", "C#"],
    G: ["G", "B", "D"],
    Ab: ["Ab", "C", "Eb"],
    A: ["A", "C#", "E"],
    Bb: ["Bb", "D", "F"],
    B: ["B", "D#", "F#"],
  };

  // Handle minor chords
  const minorMap: Record<string, string[]> = {
    Cm: ["C", "Eb", "G"],
    "C#m": ["C#", "E", "G#"],
    Dm: ["D", "F", "A"],
    "D#m": ["D#", "F#", "A#"],
    Ebm: ["Eb", "Gb", "Bb"],
    Em: ["E", "G", "B"],
    Fm: ["F", "Ab", "C"],
    "F#m": ["F#", "A", "C#"],
    Gm: ["G", "Bb", "D"],
    "G#m": ["G#", "B", "D#"],
    Abm: ["Ab", "B", "Eb"],
    Am: ["A", "C", "E"],
    Bbm: ["Bb", "Db", "F"],
    Bm: ["B", "D", "F#"],
  };

  // Clean up chord name — extract root quality
  const cleaned = root
    .replace("add9", "")
    .replace("add2", "")
    .replace("sus4", "")
    .replace("sus2", "")
    .replace("2", "")
    .replace("9", "")
    .replace("11", "")
    .replace("13", "")
    .trim();

  // Check for 7th chords
  if (cleaned.includes("m7") || cleaned.includes("min7")) {
    const base = cleaned.replace("m7", "m").replace("min7", "m");
    const tones = minorMap[base];
    if (tones) {
      // Add the minor 7th
      return tones;
    }
  }

  if (cleaned.includes("7") || cleaned.includes("maj7")) {
    const base = cleaned.replace("maj7", "").replace("7", "");
    const tones = chordMap[base];
    if (tones) return tones;
  }

  // Check minor first (longer match)
  if (cleaned.includes("m")) {
    const tones = minorMap[cleaned];
    if (tones) return tones;
  }

  // Then major
  const tones = chordMap[cleaned];
  if (tones) return tones;

  // Fallback: try just the first letter(s)
  const letter = root.match(/^[A-G][#b]?/)?.[0];
  if (letter && chordMap[letter]) return chordMap[letter];

  return ["C", "E", "G"]; // ultimate fallback
}

// Get recommended harmony notes for a voice type given a chord
function getHarmonyRecommendation(
  chord: string,
  voiceType: string,
  keySignature: string
): { primary: string; alternatives: string[]; avoid: string[] } {
  const tones = getChordTones(chord);

  // Voice-specific recommendations based on chord tones
  switch (voiceType.toLowerCase()) {
    case "soprano":
      return {
        primary: tones[2] || tones[0], // 5th or root
        alternatives: [tones[1], tones[0]], // 3rd, root
        avoid: [],
      };
    case "alto":
      return {
        primary: tones[1] || tones[0], // 3rd or root
        alternatives: [tones[2], tones[0]], // 5th, root
        avoid: [],
      };
    case "tenor":
      return {
        primary: tones[2] || tones[1], // 5th or 3rd
        alternatives: [tones[0], tones[1]], // root, 3rd
        avoid: [],
      };
    case "bass":
      return {
        primary: tones[0], // root
        alternatives: [tones[2], tones[1]], // 5th, 3rd
        avoid: [],
      };
    default:
      return {
        primary: tones[1] || tones[0],
        alternatives: tones,
        avoid: [],
      };
  }
}

// -- IMPROV ENDPOINT --
router.post("/", async (req: Request, res: Response) => {
  try {
    const { pieceId, instrument, voiceType, style } = req.body;

    if (!pieceId) {
      res.status(400).json({ error: "pieceId is required" });
      return;
    }

    if (!instrument && !voiceType) {
      res.status(400).json({ error: "Either instrument or voiceType is required" });
      return;
    }

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

    let promptText: string;

    if (isVocal) {
      // -- VOCAL HARMONY --
      // Different approach based on whether we have melody notes or not

      const hasLeadNotes =
        analysis.leadNotes &&
        Array.isArray(analysis.leadNotes) &&
        (analysis.leadNotes as any[]).length > 0;

      if (hasLeadNotes) {
        // LEAD SHEET PATH: We have actual melody notes
        // Generate harmony by computing intervals from real notes
        promptText = `You are an expert vocal arranger for worship music.

I have extracted melody notes from a lead sheet. Generate a ${voiceType} harmony part by calculating the correct harmony note for each melody note.

Song details:
- Key: ${analysis.keySignature}
- Time signature: ${analysis.timeSignature}
- Tempo: ${analysis.tempo || "not specified"}

ACTUAL MELODY NOTES (extracted from the lead sheet):
${JSON.stringify(analysis.leadNotes)}

CHORD PROGRESSION:
${JSON.stringify(analysis.chordProgression)}

RULES FOR GENERATING HARMONY:
- For EACH melody note, calculate the ${voiceType} harmony note
- Alto: sing a major or minor 3rd below the melody note (use the current chord to determine major vs minor)
- Soprano: sing a 3rd or 5th above the melody note
- Tenor: sing a 5th below or 3rd below the melody note
- Bass: sing the root of the current chord, an octave below the melody
- Every harmony note MUST be a chord tone (root, 3rd, or 5th of the current chord) or a scale tone in ${analysis.keySignature}
- Prefer smooth voice leading: move by step (2nds) or small leaps (3rds) between harmony notes
- Copy the exact duration and beat position from the melody note

Return ONLY valid JSON with no extra text or markdown:

{
  "performerType": "${voiceType} vocals",
  "songTitle": "${analysis.songTitle}",
  "style": "${musicalStyle}",
  "harmonyType": "vocal_part",
  "generationMethod": "lead_sheet_interval",
  "sections": [
    {
      "name": "Section name",
      "harmonyNotes": [
        {
          "order": 1,
          "melodyNote": "D4",
          "harmonyNote": "B3",
          "chord": "G",
          "intervalFromMelody": "minor 3rd below",
          "duration": "q",
          "beats": 1,
          "bar": 1,
          "beat": 1,
          "syllableCue": "lyric syllable if known"
        }
      ],
      "performanceNote": "Brief guidance for this section"
    }
  ],
  "generalAdvice": "Overall singing guidance"
}`;
      } else if (analysis.melodyRecognised && analysis.songTitle) {
        // CHORD CHART PATH for KNOWN songs:
        // Generate chord-tone harmony guide instead of guessing exact notes
        const chordProgression = analysis.chordProgression as any[];

        // Pre-compute harmony recommendations for each chord
        const harmonyGuide = chordProgression.map((cp: any) => {
          const rec = getHarmonyRecommendation(
            cp.chord,
            voiceType!,
            analysis.keySignature || "C major"
          );
          return {
            section: cp.section,
            order: cp.order,
            chord: cp.chord,
            chordTones: getChordTones(cp.chord),
            recommendedNote: rec.primary,
            alternatives: rec.alternatives,
          };
        });

        promptText = `You are an expert worship vocal coach teaching a ${voiceType} singer how to harmonise.

Song: "${analysis.songTitle}" in ${analysis.keySignature}, ${analysis.timeSignature} time.
Tempo: ${analysis.tempo || "moderate"}

I have pre-computed the chord tones and recommended harmony notes for each chord. Your job is to turn this into a practical, singable guide organized by section.

PRE-COMPUTED HARMONY DATA:
${JSON.stringify(harmonyGuide, null, 2)}

STRUCTURE:
${JSON.stringify(analysis.structureSections)}

Generate a section-by-section harmony guide. For each section:
1. List the chord progression with the recommended ${voiceType} note for each chord
2. Describe the voice movement between chords (e.g. "stay on B, then step down to A")
3. Flag any tricky intervals (leaps larger than a 3rd)
4. Give a performance tip

IMPORTANT: The recommendedNote values are musically correct chord tones. Use them as-is. Your job is to organize them into a readable guide and add voice-leading descriptions between chords.

Return ONLY valid JSON with no extra text or markdown:

{
  "performerType": "${voiceType} vocals",
  "songTitle": "${analysis.songTitle}",
  "style": "${musicalStyle}",
  "harmonyType": "vocal_chord_guide",
  "generationMethod": "chord_tone_guide",
  "sections": [
    {
      "name": "Verse 1",
      "chordGuide": [
        {
          "order": 1,
          "chord": "G",
          "harmonyNote": "B",
          "octaveSuggestion": 4,
          "chordTones": ["G", "B", "D"],
          "voiceLeading": "Start on B4"
        },
        {
          "order": 2,
          "chord": "Cadd9",
          "harmonyNote": "E",
          "octaveSuggestion": 4,
          "chordTones": ["C", "E", "G"],
          "voiceLeading": "Step up from B to E (ascending 4th) — or stay on B which is also a chord tone"
        }
      ],
      "performanceNote": "Keep it gentle and under the melody in the verse"
    }
  ],
  "generalAdvice": "Overall guidance for harmonising this song"
}`;
      } else {
        // CHORD CHART for UNKNOWN songs — can't generate harmony
        res.status(400).json({
          error: "Cannot generate vocal harmony for this song",
          reason:
            "This is a chord chart for a song the AI does not recognise, and no melody notes are available. Please upload a lead sheet that includes the melody written on a music staff.",
          suggestedAction: "upload_lead_sheet",
        });
        return;
      }
    } else {
      // -- INSTRUMENT IMPROV --
      // This path works great and doesn't need melody data
      promptText = `You are an experienced worship musician and arranger with deep knowledge of ${musicalStyle} style.

You are helping a ${performerType} player add tasteful improvisation and fills to a worship song.

Song analysis:
- Key: ${analysis.keySignature}
- Time signature: ${analysis.timeSignature}
- Tempo: ${analysis.tempo || "not specified"}
- Structure: ${JSON.stringify(analysis.structureSections)}
- Chord progression: ${JSON.stringify(analysis.chordProgression)}

Generate 6 to 10 specific improvisation suggestions tailored for ${performerType}.

For each suggestion specify:
- Which section it goes in
- Type: fill, run, harmony, counter-melody, sustain, or rhythmic figure
- A clear description using musical language the performer will understand
- The chord context
- Difficulty: beginner, intermediate, or advanced
- A short rationale

Make suggestions idiomatic to ${performerType}.

Return ONLY valid JSON with no extra text or markdown:

{
  "performerType": "${performerType}",
  "style": "${musicalStyle}",
  "harmonyType": "instrument_improv",
  "suggestions": [
    {
      "section": "Verse 1",
      "type": "fill",
      "description": "Description of what to play",
      "chordContext": "G to Cadd9",
      "difficulty": "beginner",
      "rationale": "Why this works"
    }
  ],
  "generalAdvice": "Overall performance guidance"
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

    const rawResponse = message.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { type: "text"; text: string }).text)
      .join("");

    const cleanedResponse = rawResponse
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const improvData = JSON.parse(cleanedResponse);

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