import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import Database from "better-sqlite3";
import { Pool } from "pg";
import { GoogleGenAI, Modality, Type } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database Abstraction
const isPostgres = !!process.env.DATABASE_URL;
let pgPool: Pool | null = null;
let sqliteDb: any = null;

if (isPostgres) {
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
} else {
  sqliteDb = new Database(path.join(process.cwd(), "commuteos.db"));
}

const db = {
  async exec(sql: string) {
    if (isPostgres) {
      await pgPool!.query(sql);
    } else {
      sqliteDb.exec(sql);
    }
  },
  async query(sql: string, params: any[] = []) {
    if (isPostgres) {
      const res = await pgPool!.query(sql, params);
      return res.rows;
    } else {
      return sqliteDb.prepare(sql).all(...params);
    }
  },
  async get(sql: string, params: any[] = []) {
    if (isPostgres) {
      const res = await pgPool!.query(sql, params);
      return res.rows[0];
    } else {
      return sqliteDb.prepare(sql).get(...params);
    }
  },
  async run(sql: string, params: any[] = []) {
    if (isPostgres) {
      await pgPool!.query(sql, params);
    } else {
      sqliteDb.prepare(sql).run(...params);
    }
  }
};

// Ensure audio directory exists for local fallback
const audioDir = path.join(process.cwd(), "public", "audio");
if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir, { recursive: true });
}

// Initialize Database
async function initDb() {
  const schema = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sections (
      id SERIAL PRIMARY KEY,
      podcast_id TEXT,
      heading TEXT,
      content TEXT,
      duration_minutes INTEGER
    );

    CREATE TABLE IF NOT EXISTS quizzes (
      id SERIAL PRIMARY KEY,
      podcast_id TEXT,
      question TEXT,
      options TEXT,
      correct_answer INTEGER
    );

    CREATE TABLE IF NOT EXISTS history (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      podcast_id TEXT,
      completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      score INTEGER
    );
  `;
  
  // Adjust schema for SQLite if needed (SQLite uses AUTOINCREMENT and different types)
  const sqliteSchema = schema
    .replace(/SERIAL PRIMARY KEY/g, "INTEGER PRIMARY KEY AUTOINCREMENT")
    .replace(/TIMESTAMP DEFAULT CURRENT_TIMESTAMP/g, "DATETIME DEFAULT CURRENT_TIMESTAMP");

  await db.exec(isPostgres ? schema : sqliteSchema);
}

initDb().catch(console.error);

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
  app.use("/audio", express.static(path.join(process.cwd(), "public", "audio")));

  app.get("/api/podcasts", async (req, res) => {
    try {
      const podcasts = await db.query("SELECT * FROM podcasts ORDER BY created_at DESC");
      res.json(podcasts);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch podcasts" });
    }
  });

  app.get("/api/podcasts/:id", async (req, res) => {
    try {
      const podcast = await db.get("SELECT * FROM podcasts WHERE id = ?", [req.params.id]);
      if (!podcast) return res.status(404).json({ error: "Podcast not found" });
      
      const sections = await db.query("SELECT * FROM sections WHERE podcast_id = ?", [req.params.id]);
      const quiz = await db.query("SELECT * FROM quizzes WHERE podcast_id = ?", [req.params.id]);
      
      res.json({ ...podcast, sections, quiz: quiz.map(q => ({ ...q, options: JSON.parse(q.options as string) })) });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch podcast details" });
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
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
