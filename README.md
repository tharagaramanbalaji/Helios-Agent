# Helios: Local LLM Assistant with Tool Integration & Benchmarking

Helios is a sleek, minimal, and highly capable local AI assistant. It integrates directly with a local Ollama instance, supports advanced local tool use (Calculator and Web Search), and features real-time inference performance benchmarking.

---

## Features

- **Local Inference**: Connects to a local Ollama instance for fast, private, and offline chat.
- **Dynamic Tool Use**:
  - **Calculator**: Automatically parses and evaluates complex mathematical expressions.
  - **Web Search**: Integrates with You.com's search API to retrieve and cite real-time web results.
- **Inference Benchmarking**: Computes and displays critical performance telemetry for every assistant generation:
  - **Time to First Token (TTFT)** (ms)
  - **Token Throughput (Tokens per second)** (tok/s)
  - **Total Response Latency** (s)
- **Modern Minimal UI**: Built with React, Vite, and custom CSS in a sleek, monochrome, high-contrast dark theme.

---

## Tech Stack

- **Backend**: FastAPI, LangChain (LangChain Ollama), WebSockets
- **Frontend**: React, Vite, CSS variables, HTML5 WebSockets

---

## Setup & Installation

### 1. Prerequisites
- **Python 3.10+**
- **Node.js 18+**
- **Ollama** installed and running locally with your model of choice (e.g., `llama3` or `qwen2.5`).

### 2. Backend Setup
1. Clone the repository and navigate to the project directory.
2. Create a virtual environment and install dependencies:
   ```bash
   python -m venv venv
   .\venv\Scripts\activate   # On Windows
   source venv/bin/activate  # On macOS/Linux
   pip install -r requirements.txt
   ```
3. Create a `.env` file in the root directory and add your settings:
   ```env
   YDC_API_KEY=your_you_dot_com_api_key_here
   OLLAMA_BASE_URL=http://localhost:11434
   DEFAULT_MODEL=qwen2.5:7b   # Or your preferred local model
   ```

### 3. Frontend Setup
1. Navigate to the `frontend` directory:
   ```bash
   cd frontend
   npm install
   ```

---

## Running the Application

For active development, run both the backend and frontend dev servers.

### 1. Start the Backend (FastAPI)
From the root directory:
```bash
.\venv\Scripts\activate
uvicorn app.main:app --reload --port 8080
```
The API documentation will be available at `http://localhost:8080/docs`.

### 2. Start the Frontend (Vite)
From the `frontend` directory:
```bash
npm run dev
```
Open `http://localhost:3000` in your browser to chat with Helios.

---

## Performance & Telemetry

When Helios streams a response, it measures generation benchmarks using high-resolution timers (`time.perf_counter()`). Upon streaming completion, these metrics are rendered in the message bubble's footer:

```
⚡ TTFT: 142.34ms · 34.25 tok/s · Latency: 1.52s
```

For a detailed analysis of local inference trade-offs (compute vs. memory bandwidth, quantization levels, VRAM limits), see [local_inference_tradeoffs.md](local_inference_tradeoffs.md).
