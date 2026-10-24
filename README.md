# 📚 SmartLib AI

### AI-Powered Smart Library Management and Research Assistant

SmartLib AI is an intelligent library platform designed to help students, faculty, researchers, and librarians discover library resources, explore research materials, and access information through an AI-powered assistant.

The project combines a React frontend, a Node.js backend, an SQLite database, and Google's Gemini API to provide a smart and accessible library experience.

---

## ✨ Features

- **AI Library Assistant:** Ask questions about books, library resources, and research topics.
- **Smart Resource Discovery:** Search for books, research papers, and digital resources.
- **Catalogue-Based Answers:** Use library catalogue records to support resource recommendations and availability information.
- **Role-Based Access:** Separate experiences for students, faculty, researchers, and librarians.
- **Library Resource Management:** Store and retrieve catalogue information using SQLite.
- **Responsive User Interface:** A clean interface built with React and CSS.
- **AI Integration:** Gemini API integration for AI-powered responses.
- **Local Fallback:** The backend can be extended to provide catalogue-based answers when the external AI service is unavailable.

---

## 🛠️ Technology Stack

| Component | Technology |
|---|---|
| Frontend | React |
| Frontend Tooling | Vite |
| Styling | CSS |
| Backend | Node.js |
| API Framework | Express.js |
| Database | SQLite |
| Database Library | better-sqlite3 |
| AI Provider | Google Gemini API |
| Authentication | JSON Web Tokens (JWT) |
| Password Hashing | bcryptjs |
| Version Control | Git and GitHub |

---

## 📂 Project Structure

```text
smartlib-ai/
├── backend/
│   ├── server.js
│   ├── package.json
│   ├── package-lock.json
│   └── smartlib.db          # Local database; do not commit
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   └── App.css
│   ├── package.json
│   └── index.html
│
├── .gitignore
└── README.md
```

*Note: The structure above highlights the main files. Your actual project may contain additional files and directories.*

---

## ⚙️ Prerequisites

Install the following before running the project:

- Node.js and npm
- Git
- Visual Studio Code
- A Google Gemini API key for Gemini-powered responses

---

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/Leenamrutha/Innovision.git
```

Navigate to the project directory:

```bash
cd Innovision/smartlib-ai
```

If your repository has a different folder structure, navigate to the directory containing the `backend` and `frontend` folders.

### 2. Configure the backend

Open a terminal in the backend directory:

```bash
cd backend
npm install
```

Create a `.env` file inside the `backend` directory.

Add your own configuration:

```env
PORT=5000
GEMINI_API_KEY=your_gemini_api_key
JWT_SECRET=replace_with_a_long_random_secret
```

Replace the example values with your actual credentials.

**Security:** Never commit your `.env` file or expose your API key in frontend code.

### 3. Start the backend

From the `backend` directory, run:

```bash
npm start
```

The backend should start at:

```text
http://localhost:5000
```

You should see a message confirming that the backend is running and the SQLite database is ready.

### 4. Configure and start the frontend

Open a second terminal in the project root and navigate to the frontend:

```bash
cd frontend
npm install
npm run dev
```

Vite will display the local frontend address in the terminal. Open that address in your browser.

---

## 🤖 AI Assistant

SmartLib AI integrates Google's Gemini API to support conversational interactions.

The intended AI workflow is:

1. Receive a user's question.
2. Retrieve relevant catalogue records.
3. Provide catalogue context to the AI assistant.
4. Return the response and relevant resource information to the frontend.
5. Use a local catalogue-based fallback when Gemini is unavailable, once that fallback is implemented and verified.

AI responses about resource availability should be grounded in actual catalogue records rather than invented library data.

**Note:** Gemini availability depends on a valid API key, supported model configuration, network connectivity, and available API quota.

---

## 🗃️ Database

The application uses SQLite to store library catalogue records locally.

Catalogue records can include information such as:

- Book or resource title
- Author
- Category
- Difficulty level
- Available copies
- Total copies
- Resource location
- Resource type

The catalogue provides the data used for resource discovery and catalogue-based assistant responses.

---

## 🔐 Security

- Keep API keys in backend environment variables.
- Do not commit `.env` files.
- Keep database files and other private data out of version control when appropriate.
- Use secure, randomly generated JWT secrets.
- Never publish real user passwords, tokens, or credentials.

---

## 🧪 Testing Checklist

After starting the application, verify the following:

- [ ] The backend starts without errors.
- [ ] The SQLite database initializes successfully.
- [ ] The frontend opens in the browser.
- [ ] Login works for configured demo accounts.
- [ ] Role-specific dashboards load correctly.
- [ ] Catalogue search returns resources.
- [ ] The AI assistant accepts questions.
- [ ] Gemini responses work when the API is available.
- [ ] The local fallback works when Gemini fails, if implemented.
- [ ] Resource availability matches the catalogue.

---

## 🔮 Future Enhancements

- Semantic search using embeddings.
- Retrieval-Augmented Generation (RAG) improvements.
- More robust AI fallback and error handling.
- Advanced book recommendation systems.
- Enhanced librarian analytics and reporting.
- Improved search filters and research discovery.
- Automated tests and deployment.

---

## 🎯 Project Goal

The goal of SmartLib AI is to make library resource discovery more accessible and efficient by combining conventional catalogue management with AI-assisted search and research support.

---

## 👩‍💻 Development

Built as part of a hackathon project focused on AI engineering, application integration, and intelligent resource discovery.

## 📄 License

No license has been specified yet. Add a license file if you intend to distribute the project under an open-source license.
