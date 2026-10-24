
import "dotenv/config";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";
import { createHash } from "node:crypto";

const app = express();
const PORT = 5000;

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;


app.use(cors({
  origin: "http://localhost:5173",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json());


// Store the database in the backend folder.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const db = new Database(path.join(__dirname, "smartlib.db"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// 1. Create database tables.
db.exec(`
  CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    category TEXT NOT NULL,
    level TEXT NOT NULL,
    availableCopies INTEGER NOT NULL DEFAULT 0,
    totalCopies INTEGER NOT NULL DEFAULT 0,
    location TEXT NOT NULL,
    type TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (
    role IN ('Student', 'Faculty', 'Researcher', 'Librarian')
  ),
  password_hash TEXT
);

  CREATE TABLE IF NOT EXISTS loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    book_id INTEGER NOT NULL,
    borrowed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    due_at TEXT NOT NULL,
    returned_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (book_id) REFERENCES books(id)
  );

  CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    book_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'fulfilled', 'cancelled')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (book_id) REFERENCES books(id)
  );
  
`);
// Store catalogue embeddings separately from the original book records.
db.exec(`
  CREATE TABLE IF NOT EXISTS book_embeddings (
    book_id INTEGER PRIMARY KEY,
    content_hash TEXT NOT NULL,
    embedding TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
  );
`);
const userColumns = db.prepare(
  "PRAGMA table_info(users)"
).all();

if (!userColumns.some((column) => column.name === "password_hash")) {
  db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT");
}
const demoUsers = [
  {
    name: "Demo Student",
    email: "student@smartlib.demo",
    password: "Student123!",
    role: "Student"
  },
  {
    name: "Demo Faculty",
    email: "faculty@smartlib.demo",
    password: "Faculty123!",
    role: "Faculty"
  },
  {
    name: "Demo Researcher",
    email: "researcher@smartlib.demo",
    password: "Research123!",
    role: "Researcher"
  },
  {
    name: "Demo Librarian",
    email: "librarian@smartlib.demo",
    password: "Librarian123!",
    role: "Librarian"
  }
];

const findUser = db.prepare(
  "SELECT id FROM users WHERE email = ?"
);

const insertUser = db.prepare(`
  INSERT INTO users (name, email, role, password_hash)
  VALUES (?, ?, ?, ?)
`);

for (const user of demoUsers) {
  if (!findUser.get(user.email)) {
    const passwordHash = bcrypt.hashSync(user.password, 10);

    insertUser.run(
      user.name,
      user.email,
      user.role,
      passwordHash
    );
  }
}
// 2. Add sample books only when the catalogue is empty.
const bookCount = db.prepare(
  "SELECT COUNT(*) AS count FROM books"
).get().count;

if (bookCount === 0) {
  const insertBook = db.prepare(`
    INSERT INTO books
    (id, title, author, category, level, availableCopies,
     totalCopies, location, type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const sampleBooks = [
    [1, "Python Programming for Beginners", "Alex Carter",
      "Programming", "Beginner", 3, 4, "Central Library Shelf A1", "Book"],
    [2, "Introduction to Machine Learning", "Sarah Mitchell",
      "Machine Learning", "Beginner", 2, 3, "Central Library Shelf B2", "Book"],
    [3, "Deep Learning Fundamentals", "James Wilson",
      "Artificial Intelligence", "Intermediate", 0, 2, "Central Library Shelf B3", "Book"],
    [4, "Retrieval-Augmented Generation: An Overview", "Sample Research Team",
      "Generative AI", "Intermediate", 1, 1, "Digital Research Collection", "Research Paper"],
    [5, "Data Science Essentials", "Priya Sharma",
      "Data Science", "Beginner", 4, 5, "Central Library Shelf C1", "Book"]
  ];

  const seed = db.transaction(() => {
    for (const book of sampleBooks) {
      insertBook.run(...book);
    }
  });

  seed();
}

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is missing. Check backend/.env");
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ error: "Please log in first." });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const user = db.prepare(`
      SELECT id, name, email, role
      FROM users
      WHERE id = ?
    `).get(payload.userId);

    if (!user) {
      return res.status(401).json({ error: "User account not found." });
    }

    req.user = user;
    next();
  } catch {
    return res.status(401).json({
      error: "Invalid or expired login token."
    });
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: "You do not have permission to perform this action."
      });
    }

    next();
  };
}
// Convert text into a Gemini embedding vector.
// Retry temporary Gemini API failures with exponential backoff.
async function withGeminiRetry(operation, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const details = [
        error?.message,
        error?.status,
        error?.code,
        error?.error?.status,
        error?.error?.message
      ].filter(Boolean).join(" ");

      const retryable =
        /429|500|502|503|504|RESOURCE_EXHAUSTED|UNAVAILABLE|high demand|rate.?limit|temporar/i
          .test(details);

      if (!retryable || attempt === maxAttempts) {
        throw error;
      }

      const delayMs = 1000 * 2 ** (attempt - 1);

      console.warn(
        `Temporary Gemini failure. Retry ${attempt + 1}/${maxAttempts} in ${delayMs}ms.`
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error("Gemini request failed after retries.");
}

// Convert text into a Gemini embedding vector.
async function embedText(text, taskType) {
  if (!genAI) {
    throw new Error("Gemini is not configured.");
  }

  const result = await withGeminiRetry(() =>
    genAI.models.embedContent({
      model: "gemini-embedding-001",
      contents: text,
      config: {
        taskType,
        outputDimensionality: 768
      }
    })
  );

  const values = result.embeddings?.[0]?.values;

  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Gemini returned an empty embedding.");
  }

  return values;
}
  

// Build consistent searchable text from a catalogue record.
function getBookSearchText(book) {
  return [
    `Title: ${book.title}`,
    `Author: ${book.author}`,
    `Category: ${book.category}`,
    `Level: ${book.level}`,
    `Resource type: ${book.type}`,
    `Location: ${book.location}`,
    `Available copies: ${book.availableCopies}`,
    `Total copies: ${book.totalCopies}`
  ].join("\n");
}

// Ensure every book has a current, stored embedding.
async function ensureBookEmbeddings(books) {
  const getStored = db.prepare(`
    SELECT content_hash, embedding
    FROM book_embeddings
    WHERE book_id = ?
  `);

  const saveEmbedding = db.prepare(`
    INSERT INTO book_embeddings
      (book_id, content_hash, embedding, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(book_id) DO UPDATE SET
      content_hash = excluded.content_hash,
      embedding = excluded.embedding,
      updated_at = CURRENT_TIMESTAMP
  `);

  for (const book of books) {
    const searchableText = getBookSearchText(book);

    const contentHash = createHash("sha256")
      .update(searchableText)
      .digest("hex");

    const stored = getStored.get(book.id);

    // Reuse the saved vector when the searchable text has not changed.
    if (stored && stored.content_hash === contentHash) {
      continue;
    }

    // Generate a new vector for a new or updated book.
    const embedding = await embedText(
      searchableText,
      "RETRIEVAL_DOCUMENT"
    );

    saveEmbedding.run(
      book.id,
      contentHash,
      JSON.stringify(embedding)
    );
  }
}

// Measure how closely two vectors point in the same direction.
function cosineSimilarity(vectorA, vectorB) {
  if (
    !Array.isArray(vectorA) ||
    !Array.isArray(vectorB) ||
    vectorA.length !== vectorB.length ||
    vectorA.length === 0
  ) {
    return 0;
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < vectorA.length; i++) {
    dotProduct += vectorA[i] * vectorB[i];
    magnitudeA += vectorA[i] * vectorA[i];
    magnitudeB += vectorB[i] * vectorB[i];
  }

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
}

// Retrieve the most relevant catalogue records for a question.
async function semanticBookSearch(question, limit = 4) {
  const books = db.prepare(`
    SELECT
      id, title, author, category, level,
      availableCopies, totalCopies, location, type
    FROM books
    ORDER BY title
  `).all();

  if (books.length === 0) {
    return [];
  }

  // Create or refresh saved vectors before searching.
  await ensureBookEmbeddings(books);

  // Embed the user's question using the query task type.
  const questionEmbedding = await embedText(
    question,
    "RETRIEVAL_QUERY"
  );

  const getEmbedding = db.prepare(`
    SELECT embedding
    FROM book_embeddings
    WHERE book_id = ?
  `);

  const rankedBooks = books.map((book) => {
    const stored = getEmbedding.get(book.id);
    const bookEmbedding = stored
      ? JSON.parse(stored.embedding)
      : [];

    return {
      ...book,
      similarity: cosineSimilarity(
        questionEmbedding,
        bookEmbedding
      )
    };
  });

  // Highest semantic similarity first.
  rankedBooks.sort((a, b) => b.similarity - a.similarity);

  // Filter weak matches rather than inventing a catalogue result.
  return rankedBooks
    .filter((book) => book.similarity >= 0.30)
    .slice(0, limit);
}
app.post("/api/auth/login", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = req.body?.password;

  if (!email || typeof password !== "string" || !password) {
    return res.status(400).json({
      error: "Email and password are required."
    });
  }

  const user = db.prepare(`
    SELECT id, name, email, role, password_hash
    FROM users
    WHERE email = ?
  `).get(email);

  if (
    !user ||
    !user.password_hash ||
    !bcrypt.compareSync(password, user.password_hash)
  ) {
    return res.status(401).json({
      error: "Incorrect email or password."
    });
  }

  const token = jwt.sign(
    { userId: user.id },
    process.env.JWT_SECRET,
    { expiresIn: "2h" }
  );

  res.json({
    message: "Login successful",
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    }
  });
});

app.get("/api/auth/me", authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

app.get(
  "/api/librarian/analytics",
  authenticateToken,
  requireRole("Librarian"),
  (req, res) => {
    const stats = db.prepare(`
      SELECT
        COUNT(*) AS totalTitles,
        COALESCE(SUM(totalCopies), 0) AS totalCopies,
        COALESCE(SUM(availableCopies), 0) AS availableCopies
      FROM books
    `).get();

    const activeLoans = db.prepare(`
      SELECT COUNT(*) AS count
      FROM loans
      WHERE returned_at IS NULL
    `).get().count;

    res.json({
      ...stats,
      borrowedCopies: stats.totalCopies - stats.availableCopies,
      activeLoans
    });
  }
);

// 3. Health check.
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "SmartLib AI backend is running",
    database: "SQLite connected"
  });
});

// 4. Search the catalogue.
app.get("/api/books", (req, res) => {
  const query = String(req.query.q || "").trim();

  if (!query) {
    const books = db.prepare(
      "SELECT * FROM books ORDER BY title"
    ).all();
    return res.json(books);
  }

  const term = `%${query}%`;

  const books = db.prepare(`
    SELECT * FROM books
    WHERE title LIKE ?
       OR author LIKE ?
       OR category LIKE ?
       OR level LIKE ?
       OR type LIKE ?
    ORDER BY title
  `).all(term, term, term, term, term);

  res.json(books);
});

// 5. Get one book.
app.get("/api/books/:id", (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid book ID" });
  }

  const book = db.prepare(
    "SELECT * FROM books WHERE id = ?"
  ).get(id);

  if (!book) {
    return res.status(404).json({ error: "Book not found" });
  }

  res.json(book);
});

// 6. Check availability.
app.get("/api/books/:id/availability", (req, res) => {
  const id = Number(req.params.id);

  const book = db.prepare(`
    SELECT id, title, availableCopies, totalCopies, location
    FROM books WHERE id = ?
  `).get(id);

  if (!book) {
    return res.status(404).json({ error: "Book not found" });
  }

  res.json({
    ...book,
    available: book.availableCopies > 0,
    message: book.availableCopies > 0
      ? `${book.availableCopies} copy/copies available`
      : "Currently unavailable"
  });
});

// 7. Librarian inventory overview.
app.get(
  "/api/analytics/overview",
  authenticateToken,
  requireRole("Librarian"),
  (req, res) => {
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS totalTitles,
      COALESCE(SUM(totalCopies), 0) AS totalCopies,
      COALESCE(SUM(availableCopies), 0) AS availableCopies
    FROM books
  `).get();

  const activeLoans = db.prepare(`
    SELECT COUNT(*) AS count
    FROM loans
    WHERE returned_at IS NULL
  `).get().count;

  res.json({
    ...stats,
    borrowedCopies: stats.totalCopies - stats.availableCopies,
    activeLoans
  });
});



// 8. SmartLib AI Assistant — semantic search + RAG.
app.post("/api/ai/chat", authenticateToken, async (req, res) => {
  try {
    const message = req.body?.message;

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        error: "Please enter a question."
      });
    }

    if (message.length > 1000) {
      return res.status(400).json({
        error: "Your question must be 1000 characters or fewer."
      });
    }

    if (!genAI) {
      return res.status(503).json({
        error: "Gemini is not configured. Check backend/.env."
      });
    }

    // STEP 1: Retrieve relevant books using semantic search.
    const retrievedBooks = await semanticBookSearch(
      message.trim(),
      4
    );

    const catalogueContext = retrievedBooks.map((book) => ({
      id: book.id,
      title: book.title,
      author: book.author,
      category: book.category,
      level: book.level,
      type: book.type,
      location: book.location,
      availableCopies: book.availableCopies,
      totalCopies: book.totalCopies
    }));

    // STEP 2: Generate an answer using the retrieved records.
    const prompt = `
You are SmartLib AI, a helpful university library assistant.

The authenticated user's role is: ${req.user.role}

USER QUESTION:
${message.trim()}

RETRIEVED LIBRARY RECORDS:
${JSON.stringify(catalogueContext, null, 2)}

STRICT RULES:
1. Never invent book titles, authors, locations, or availability.
2. Use the retrieved records as the source of truth for catalogue facts.
3. Recommend a catalogue resource only if it appears in the retrieved records.
4. For availability questions, use the exact availableCopies and totalCopies
   values from the retrieved records.
5. If no relevant record was retrieved, say that no matching resource was
   found in the retrieved catalogue records.
6. Do not claim that the entire library has been searched when no relevant
   record was retrieved.
7. You may explain general educational concepts using general knowledge.
   Do not present general knowledge as verified catalogue information.
8. Do not claim to reserve, borrow, renew, or modify any record.
9. Do not reveal passwords, API keys, or private user information.
10. Be concise, friendly, and transparent.

Answer the user's question now.
`;

    // STEP 3: Generate the answer with retries for temporary failures.
    const result = await withGeminiRetry(() =>
      genAI.models.generateContent({
       model: "gemini-3.8-flash",
        contents: prompt,
        config: {
          temperature: 0.2
        }
      })
    );

    const answer = result.text;

    if (!answer) {
      return res.status(502).json({
        error: "Gemini returned an empty response. Please try again."
      });
    }

    // STEP 4: Return the actual retrieved catalogue records as sources.
    const sources = retrievedBooks.map((book) => ({
      id: book.id,
      title: book.title,
      author: book.author,
      category: book.category,
      level: book.level,
      type: book.type,
      location: book.location,
      availableCopies: book.availableCopies,
      totalCopies: book.totalCopies,
      similarity: Number(book.similarity.toFixed(4))
    }));

    return res.json({
      answer,
      sources
    });

  } catch (error) {
    console.error("SmartLib RAG error:", error);

    return res.status(500).json({
      error: "The AI assistant is temporarily unavailable. Please try again."
    });
  }
});
// 9. Start the server — only once, at the end.
app.listen(PORT, () => {
  console.log(`SmartLib AI backend running at http://localhost:${PORT}`);
  console.log("SQLite database is ready.");

  if (!genAI) {
    console.warn("GEMINI_API_KEY is missing. AI requests will be unavailable.");
  }
});