import "dotenv/config";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";

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



// 8. SmartLib AI Assistant — answers grounded in the book catalogue.
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
        error: "Gemini is not configured. Check GEMINI_API_KEY in backend/.env."
      });
    }

    // Fetch real catalogue records from SQLite.
    const books = db.prepare(`
      SELECT
        id, title, author, category, level,
        availableCopies, totalCopies, location, type
      FROM books
      ORDER BY title
    `).all();

    const prompt = `
You are SmartLib AI, a helpful university library assistant.

The current user's role is: ${req.user.role}

Answer the user's question using the catalogue supplied below.

Rules:
- Never invent book titles, authors, locations, or availability.
- Use the catalogue as the source of truth for library inventory.
- Recommend matching books and explain briefly why they are relevant.
- For availability questions, use the exact availableCopies and totalCopies values.
- If no relevant catalogue item exists, say that clearly.
- You may explain general educational concepts, but distinguish them from
  information verified in the catalogue.
- Do not reveal passwords, API keys, or private user information.
- Do not claim to reserve, borrow, or renew books; this endpoint does not
  perform those actions.
- Be concise and friendly.

CATALOGUE:
${JSON.stringify(books, null, 2)}

USER QUESTION:
${message.trim()}
`;

let result;
let lastError;

for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    result = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        temperature: 0.2
      }
    });

    break;
  } catch (error) {
    lastError = error;

    const errorMessage = String(
      error?.message || error
    );

    const isTemporaryError =
      /503|UNAVAILABLE|high demand|429|RESOURCE_EXHAUSTED|500|INTERNAL/i
        .test(errorMessage);

    if (!isTemporaryError || attempt === 3) {
      throw error;
    }

    console.warn(
      `Gemini temporarily unavailable. Retry ${attempt}/3...`
    );

    await new Promise(resolve =>
      setTimeout(resolve, attempt * 1500)
    );
  }
}

if (!result) {
  throw lastError || new Error("Gemini did not return a result.");
}

const answer = result.text;

    if (!answer) {
      return res.status(502).json({
        error: "Gemini returned an empty response. Please try again."
      });
    }

    // Return catalogue records actually referenced in the answer.
    const answerLower = answer.toLowerCase();

    const sources = books
      .filter(book => answerLower.includes(book.title.toLowerCase()))
      .map(book => ({
        id: book.id,
        title: book.title,
        author: book.author,
        location: book.location,
        availableCopies: book.availableCopies,
        totalCopies: book.totalCopies
      }));

    return res.json({
      answer,
      sources
    });

  } catch (error) {
    console.error("SmartLib AI error:", error);

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