import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import Database from "better-sqlite3";
import { GoogleGenAI, Modality, Type } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("commuteos.db");

// Ensure audio directory exists
const audioDir = path.join(__dirname, "public", "audio");
if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir, { recursive: true });
}

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS podcasts (
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    topic TEXT,
    level TEXT,
    mode TEXT,
    duration INTEGER,
    title TEXT,
    summary TEXT,
    audio_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    podcast_id TEXT,
    heading TEXT,
    content TEXT,
    duration_minutes INTEGER,
    FOREIGN KEY(podcast_id) REFERENCES podcasts(id)
  );

  CREATE TABLE IF NOT EXISTS quizzes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    podcast_id TEXT,
    question TEXT,
    options TEXT, -- JSON array
    correct_answer INTEGER,
    FOREIGN KEY(podcast_id) REFERENCES podcasts(id)
  );

  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    podcast_id TEXT,
    completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    score INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(podcast_id) REFERENCES podcasts(id)
  );
`);

function parseJsonResponse(text: string) {
  try {
    // Remove markdown code blocks if present
    const cleanText = text.replace(/```json\n?|```/g, "").trim();
    return JSON.parse(cleanText);
  } catch (e) {
    console.error("Failed to parse JSON response:", text);
    throw new Error("Invalid JSON response from AI");
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API Routes
  app.use("/audio", express.static(path.join(__dirname, "public", "audio")));

  app.get("/api/podcasts", (req, res) => {
    const podcasts = db.prepare("SELECT * FROM podcasts ORDER BY created_at DESC").all();
    res.json(podcasts);
  });

  app.get("/api/podcasts/:id", (req, res) => {
    const podcast = db.prepare("SELECT * FROM podcasts WHERE id = ?").get(req.params.id);
    if (!podcast) return res.status(404).json({ error: "Podcast not found" });
    
    const sections = db.prepare("SELECT * FROM sections WHERE podcast_id = ?").all(req.params.id);
    const quiz = db.prepare("SELECT * FROM quizzes WHERE podcast_id = ?").all(req.params.id);
    
    res.json({ ...podcast, sections, quiz: quiz.map(q => ({ ...q, options: JSON.parse(q.options as string) })) });
  });

  app.post("/api/generate", async (req, res) => {
    const { topic, duration, level, mode } = req.body;
    console.log(`[Generate] Starting generation for: ${topic} (${duration}m, ${level}, ${mode})`);

    try {
      // Try both possible environment variables
      const rawKey = process.env.GEMINI_API_KEY || process.env.API_KEY || "";
      const apiKey = rawKey.trim();
      
      console.log(`[Generate] API Key detected. Length: ${apiKey.length}`);

      if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey.length < 10) {
        console.error(`[Generate] Invalid or placeholder API Key. Length: ${apiKey.length}`);
        return res.status(401).json({ 
          error: `Gemini API key is missing or invalid (detected length: ${apiKey.length}). Please ensure GEMINI_API_KEY is set correctly in the Secrets panel.` 
        });
      }
      
      const ai = new GoogleGenAI({ apiKey });

      // Stage 1: Outline
      console.log("[Generate] Stage 1: Generating outline...");
      const outlineResponse = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: [{ parts: [{ text: `Generate a structured outline for a podcast about "${topic}". 
        Target duration: ${duration} minutes. 
        Skill level: ${level}. 
        Mode: ${mode}. 
        Limit to exactly 3-4 key sections.` }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              sections: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    heading: { type: Type.STRING },
                    duration_minutes: { type: Type.NUMBER },
                    key_points: { type: Type.ARRAY, items: { type: Type.STRING } },
                    requires_citation: { type: Type.BOOLEAN }
                  }
                }
              }
            }
          }
        }
      });

      const outline = parseJsonResponse(outlineResponse.text);
      console.log("[Generate] Outline generated:", outline.title);
      const podcastId = Math.random().toString(36).substring(7);

      // Stage 2 & 3: Parallel Generation
      console.log("[Generate] Stage 2 & 3: Generating sections in parallel...");
      const sectionPromises = outline.sections.slice(0, 4).map(async (section: any) => {
        try {
          const sectionContent = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: [{ parts: [{ text: `Generate a detailed podcast script for the section "${section.heading}" about "${topic}". 
            Key points to cover: ${section.key_points.join(", ")}. 
            This section should be roughly ${section.duration_minutes} minutes long. 
            Tone: ${mode}. 
            Level: ${level}.` }] }],
            config: {
              systemInstruction: "You are a professional podcast scriptwriter. Write engaging, conversational, and factual content."
            }
          });
          return { ...section, content: sectionContent.text || "Content generation failed." };
        } catch (err) {
          console.error(`[Generate] Failed section ${section.heading}:`, err);
          return { ...section, content: "Content unavailable due to generation error." };
        }
      });

      const generatedSections = await Promise.all(sectionPromises);
      console.log("[Generate] All sections generated.");

      // Stage 6: Full Podcast TTS
      console.log("[Generate] Stage 6: Generating full audio pipeline...");
      let audioUrl = null;
      try {
        const audioChunks: Buffer[] = [];
        for (const [index, section] of generatedSections.entries()) {
          console.log(`[Generate] TTS for section ${index + 1}/${generatedSections.length}...`);
          // Chunk text if it's too long for a single TTS call
          const textToSpeak = section.content.substring(0, 1500); 
          
          const ttsResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: textToSpeak }] }],
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
              }
            }
          });

          const audioBase64 = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
          if (audioBase64) {
            audioChunks.push(Buffer.from(audioBase64, 'base64'));
          }
        }

        if (audioChunks.length > 0) {
          const finalBuffer = Buffer.concat(audioChunks);
          const fileName = `${podcastId}.mp3`;
          const filePath = path.join(audioDir, fileName);
          fs.writeFileSync(filePath, finalBuffer);
          
          // Use APP_URL if available, otherwise relative path
          const baseUrl = process.env.APP_URL || "";
          audioUrl = `${baseUrl}/audio/${fileName}`;
          console.log("[Generate] Full audio generated and stored at:", audioUrl);
        }
      } catch (err) {
        console.error("[Generate] Full TTS pipeline failed:", err);
      }

      // Save to DB
      console.log("[Generate] Saving to database...");
      db.prepare("INSERT INTO podcasts (id, topic, level, mode, duration, title, summary, audio_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(podcastId, topic, level, mode, duration, outline.title, `A ${duration}-minute ${level} session on ${topic}.`, audioUrl);

      for (const s of generatedSections) {
        db.prepare("INSERT INTO sections (podcast_id, heading, content, duration_minutes) VALUES (?, ?, ?, ?)")
          .run(podcastId, s.heading, s.content, s.duration_minutes);
      }

      // Quiz Generation
      console.log("[Generate] Generating quiz...");
      try {
        const quizResponse = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [{ parts: [{ text: `Generate 3 multiple choice questions based on this content: ${generatedSections.map(s => s.content).join(" ").substring(0, 3000)}` }] }],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  question: { type: Type.STRING },
                  options: { type: Type.ARRAY, items: { type: Type.STRING } },
                  correct_answer: { type: Type.NUMBER }
                }
              }
            }
          }
        });

        const quizItems = parseJsonResponse(quizResponse.text);
        for (const q of quizItems) {
          db.prepare("INSERT INTO quizzes (podcast_id, question, options, correct_answer) VALUES (?, ?, ?, ?)")
            .run(podcastId, q.question, JSON.stringify(q.options), q.correct_answer);
        }
        console.log("[Generate] Quiz generated.");
      } catch (err) {
        console.error("[Generate] Quiz failed:", err);
      }

      console.log("[Generate] Success!");
      res.json({ id: podcastId, ...outline, audio_url: audioUrl });
    } catch (error: any) {
      console.error("[Generate] Fatal error:", error);
      res.status(500).json({ error: error.message || "An unexpected error occurred during generation." });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
