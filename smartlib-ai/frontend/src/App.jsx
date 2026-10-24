import { useEffect, useState } from "react";
import "./App.css";

const API = "http://localhost:5000/api";

const DEMO_ACCOUNTS = [
  {
    role: "Student",
    email: "student@smartlib.demo",
    password: "Student123!",
  },
  {
    role: "Faculty",
    email: "faculty@smartlib.demo",
    password: "Faculty123!",
  },
  {
    role: "Researcher",
    email: "researcher@smartlib.demo",
    password: "Research123!",
  },
  {
    role: "Librarian",
    email: "librarian@smartlib.demo",
    password: "Librarian123!",
  },
];

function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(
    () => sessionStorage.getItem("smartlib_token") || ""
  );

  const [email, setEmail] = useState("student@smartlib.demo");
  const [password, setPassword] = useState("Student123!");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const [query, setQuery] = useState("");
  const [books, setBooks] = useState([]);
  const [analytics, setAnalytics] = useState(null);

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  // Restore the signed-in user when the page reloads.
  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    async function restoreSession() {
      try {
        const response = await fetch(`${API}/auth/me`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error("Session expired");
        }

        const result = await response.json();

        if (!cancelled) {
          setUser(result.user);
        }
      } catch {
        if (!cancelled) {
          sessionStorage.removeItem("smartlib_token");
          setToken("");
          setUser(null);
        }
      }
    }

    restoreSession();

    return () => {
      cancelled = true;
    };
  }, [token]);

 async function handleLogin(event) {
  event.preventDefault();

  setLoginError("");
  setLoginLoading(true);

  try {
    const response = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: email.trim(),
        password,
      }),
    });

    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      const responseText = await response.text();
      console.error("Unexpected backend response:", responseText);

      throw new Error(
        "The backend returned HTML instead of JSON. Check backend/server.js and the login route."
      );
    }

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result.message || result.error || "Login failed."
      );
    }

    if (!result.token || !result.user) {
      throw new Error("The backend did not return a valid login session.");
    }

    sessionStorage.setItem("smartlib_token", result.token);

    setToken(result.token);
    setUser(result.user);
  } catch (error) {
    console.error("Login error:", error);

    setLoginError(
      error.message || "Cannot connect to the backend."
    );
  } finally {
    setLoginLoading(false);
  }
}

  function logout() {
    sessionStorage.removeItem("smartlib_token");

    setToken("");
    setUser(null);
    setBooks([]);
    setAnalytics(null);
    setQuery("");
    setMessage("");
  }

  // Fetch books. Your current backend returns an array.
  // The fallback also supports the older { data, count } format.
  async function searchBooks(searchTerm = "") {
    setLoading(true);

    try {
      const response = await fetch(
        `${API}/books?q=${encodeURIComponent(searchTerm)}`
      );

      if (!response.ok) {
        throw new Error("Catalog request failed");
      }

      const result = await response.json();

      const list = Array.isArray(result)
        ? result
        : result.data || [];

      setBooks(list);

      setMessage(
        list.length > 0
          ? `${list.length} resource(s) found`
          : "not_found: No matching resource was found."
      );
    } catch {
      setBooks([]);
      setMessage(
        "Cannot connect to the catalogue. Check your backend."
      );
    } finally {
      setLoading(false);
    }
  }

  // Only librarians can retrieve this protected endpoint.
  async function loadAnalytics(authToken) {
    try {
      const response = await fetch(
        `${API}/librarian/analytics`,
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error("Analytics unavailable");
      }

      setAnalytics(await response.json());
    } catch {
      setAnalytics(null);
    }
  }

  useEffect(() => {
    if (!user || !token) return;

    searchBooks();

    if (user.role === "Librarian") {
      loadAnalytics(token);
    } else {
      setAnalytics(null);
    }
  }, [user, token]);

  async function checkAvailability(book) {
    try {
      const response = await fetch(
        `${API}/books/${book.id}/availability`
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Availability check failed");
      }

      window.alert(
        `${result.title}\n` +
          `Available: ${result.available ? "Yes" : "No"}\n` +
          `Available copies: ${result.availableCopies}\n` +
          `Location: ${result.location}`
      );
    } catch (error) {
      window.alert(error.message);
    }
  }

  function handleSearch(event) {
    event.preventDefault();
    searchBooks(query);
  }

  // Login page
  if (!user) {
    return (
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="brand-icon">S</span>

            <div>
              <h1>SmartLib AI</h1>
              <p>Smart Library Management Assistant</p>
            </div>
          </div>
        </header>

        <main className="main">
          <section className="login-card">
            <p className="eyebrow">WELCOME TO SMARTLIB AI</p>

            <h2>Sign in to your library</h2>

            <p className="login-description">
              Access library resources, research assistance,
              and personalized discovery.
            </p>

            <form
              className="login-form"
              onSubmit={handleLogin}
            >
              <label htmlFor="email">Email address</label>

              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                required
              />

              <label htmlFor="password">Password</label>

              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />

              {loginError && (
                <p className="login-error" role="alert">
                  {loginError}
                </p>
              )}

              <button
                type="submit"
                className="login-button"
                disabled={loginLoading}
              >
                {loginLoading ? "Signing in..." : "Sign in"}
              </button>
            </form>

            <div className="demo-accounts">
              <h3>Hackathon demo accounts</h3>

              <p>
                Select a role to autofill its demonstration
                credentials.
              </p>

              <div className="demo-role-buttons">
                {DEMO_ACCOUNTS.map((account) => (
                  <button
                    type="button"
                    key={account.role}
                    onClick={() => {
                      setEmail(account.email);
                      setPassword(account.password);
                      setLoginError("");
                    }}
                  >
                    {account.role}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </main>

        <footer>
          SmartLib AI · Hackathon prototype
        </footer>
      </div>
    );
  }

  const isLibrarian = user.role === "Librarian";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">S</span>

          <div>
            <h1>SmartLib AI</h1>
            <p>Smart Library Management Assistant</p>
          </div>
        </div>

        <div className="account-controls">
          <div className="account-info">
            <strong>{user.name}</strong>
            <span>{user.role}</span>
          </div>

          <button
            className="logout-button"
            onClick={logout}
          >
            Logout
          </button>
        </div>
      </header>

      <main className="main">
        <section className="welcome">
          <p className="eyebrow">
            {isLibrarian
              ? "LIBRARY ADMINISTRATION"
              : "YOUR SMART LIBRARY"}
          </p>

          <h2>
            {isLibrarian
              ? "Library overview"
              : `Welcome, ${user.name}`}
          </h2>

          <p>
            {isLibrarian
              ? "Monitor the collection and explore library statistics."
              : "Discover resources and explore research relevant to your interests."}
          </p>
        </section>

        {isLibrarian && (
          <section className="stats-grid">
            {[
              ["Resource titles", analytics?.totalTitles],
              ["Total copies", analytics?.totalCopies],
              ["Available copies", analytics?.availableCopies],
              ["Borrowed copies", analytics?.borrowedCopies],
            ].map(([label, value]) => (
              <article className="stat-card" key={label}>
                <p>{label}</p>
                <h3>{value ?? "—"}</h3>
              </article>
            ))}
          </section>
        )}

        <section className="section">
          <div className="section-heading">
            <div>
              <h3>Explore library resources</h3>
              <p>
                Search books, research papers, and digital resources.
              </p>
            </div>
          </div>

          <form className="search-form" onSubmit={handleSearch}>
            <span aria-hidden="true">⌕</span>

            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Python, machine learning, research..."
              aria-label="Search library resources"
            />

            <button type="submit" disabled={loading}>
              {loading ? "Searching..." : "Search"}
            </button>
          </form>

          <p className="message" role="status">
            {message}
          </p>

          <div className="book-grid">
            {books.map((book) => (
              <article className="book-card" key={book.id}>
                <div className="book-cover">
                  <span>
                    {book.type === "Book" ? "BOOK" : "PAPER"}
                  </span>

                  <span className="cover-symbol">✳</span>
                </div>

                <div className="book-info">
                  <span className="category">
                    {book.category}
                  </span>

                  <h4>{book.title}</h4>

                  <p className="author">
                    By {book.author}
                  </p>

                  <p className="location">
                    {book.location}
                  </p>

                  <p
                    className={
                      book.availableCopies > 0
                        ? "availability available"
                        : "availability unavailable"
                    }
                  >
                    {book.availableCopies > 0
                      ? `${book.availableCopies} available`
                      : "Currently unavailable"}
                  </p>

                  <button
                    className="secondary-button"
                    onClick={() => checkAvailability(book)}
                  >
                    Check availability
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        {isLibrarian && (
          <section className="section">
            <div className="section-heading">
              <div>
                <h3>Catalog snapshot</h3>
                <p>Resources currently in the catalogue.</p>
              </div>
            </div>

            <div className="book-grid">
              {books.map((book) => (
                <article
                  className="book-card compact-card"
                  key={book.id}
                >
                  <div className="book-info">
                    <span className="category">
                      {book.category}
                    </span>

                    <h4>{book.title}</h4>

                    <p className="author">
                      {book.author}
                    </p>

                    <p>
                      {book.availableCopies} of {book.totalCopies}{" "}
                      available
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer>
        SmartLib AI · Authenticated session · Hackathon prototype
      </footer>
    </div>
  );
}

export default App;
