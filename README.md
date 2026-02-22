# Reviewer Intense 🧠⚡

**A minimal, self-hosted, spaced-repetition flashcard reviewer for intense memory training.**

Reviewer Intense is a lightweight web application designed to help you memorize anything using a dynamic, algorithm-driven review schedule. It's built for simplicity, speed, and effectiveness, running entirely on your local machine.

---

## ✨ Core Features

*   **🔁 Dynamic Spaced Repetition**: Employs a smart scheduling algorithm. Items you **forget** are rescheduled at a random interval (8-12 positions later) for more frequent review, while items you **remember** are progressively mastered.
*   **🎯 Mastery-Based Tracking**: Tracks your progress clearly (`Mastered/Total`). An item is considered "mastered" after its first review or after two consecutive correct recalls.
*   **⌨️ Keyboard-First Design**: Navigate entirely with your keyboard for a fluid, uninterrupted review flow.
    *   `Space` = Show Answer
    *   `F` = Forgot
    *   `J` = Remembered
*   **🎨 Clean & Adaptive UI**: Features a clean, modern interface with automatic light/dark mode support based on your system preferences.
*   **📁 Simple File-Based Knowledge Bases**: Your flashcards are stored in straightforward `.json` files. Easy to create, edit, and manage.
*   **🚀 Self-Contained & Local**: Your data never leaves your machine. The backend server runs locally, ensuring privacy and eliminating latency.

---

## 🏗️ Architecture

This is a full-stack application with a clear separation between the frontend and backend.

*   **Frontend (`index.html`, `style.css`, `script.js`)**: A static, responsive web interface that handles user interaction, review logic, and communicates with the backend API.
*   **Backend (`backend.py`)**: A lightweight Flask server that:
    *   Serves the frontend static files.
    *   Provides an API to list and load knowledge base (`.json`) files from a configured directory.
    *   Generates stable IDs for flashcards based on their content.
*   **Configuration (`config.json`)**: A simple file to set the path to your knowledge base directory.

---

## 🚀 Quick Start

### Prerequisites
*   Python 3.7+
*   Flask (`pip install flask flask-cors`)

### Steps
1.  **Clone or download** the project files.
2.  **Configure** the `config.json` file to point to your desired knowledge base directory (e.g., `"D:\\knowledge_bases"`).
3.  **Create a knowledge base**: Place a `.json` file in your configured directory. The file should contain a list of objects with `"question"` and `"answer"` fields. An `"id"` field is optional and will be auto-generated.
    ```json
    [
      { "question": "What is the capital of France?", "answer": "Paris" },
      { "question": "Explain Newton's First Law.", "answer": "An object at rest stays at rest..." }
    ]
    ```
4.  **Start the backend server**:
    ```bash
    python backend.py
    ```
5.  **Open your browser** and navigate to `http://localhost:1204`.

---

## 📖 How to Use

### Before using

1. Download Reviewer-Intense-v1.0.0.zip, extract it.
2. Run backend.py with pythonw.exe.
    > Tip: You can configure it to run automatically at startup using the Task Scheduler.  
<img width="882" height="480" alt="image" src="https://github.com/user-attachments/assets/c2736790-bb39-43ea-9275-c61d1aa0fe65" />
3. Edit `config.json` to customize:
*   `KNOWLEDGE_DIR`: The absolute path to the folder where your `.json` knowledge base files are stored.
4. Run index.html.
    > Tip: You can use Edge app mode for better experience.

### After the app start

1.  **Select a Knowledge Base**: Use the dropdown in the header to choose a `.json` file to review.
2.  **Review**:
    *   The **question** is displayed.
    *   Press `Space` to reveal the **answer**.
3.  **Self-Assess**:
    *   Press `F` if you **forgot** the answer. The item will be rescheduled soon.
    *   Press `J` if you **remembered** the answer. The item moves closer to mastery.
4.  **Track Progress**: Watch the `Mastered/Total` counter in the header grow as you learn.

The application will automatically sequence the cards based on your performance, focusing your time on the items that need the most attention.

---

## 📂 Project Structure
```
reviewer-intense/
├── index.html          # Main application page
├── style.css           # Application styles (light/dark theme)
├── script.js           # Frontend logic & review algorithm
├── backend.py          # Flask server & API
├── config.json         # Configuration (knowledge base path)
└── (knowledge_bases/)  # Your .json flashcard files (location configurable)
```

---

## 🛠️ Development

This is a long-term project focused on core review functionality. The code is structured for clarity:
*   The review scheduler logic is in `script.js` (`handleAction` function).
*   The backend API in `backend.py` is minimal and focused on file operations.
*   Styling in `style.css` uses CSS custom properties for easy theming.

Feedback and contributions focused on improving the review algorithm, UX, or code structure are welcome.

