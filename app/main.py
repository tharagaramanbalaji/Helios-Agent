from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, StreamingResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from langchain_ollama import ChatOllama
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, ToolMessage
from app.agent import calculate, websearch, python_interpreter

from app.config import settings
from app.schemas import ChatRequest, ChatResponse, Message

from pydantic import BaseModel
from typing import Optional, Dict
import httpx
import json
import os
import time
import subprocess
import shutil

app = FastAPI(title=settings.app_name)

# CORS middleware (needed in dev when Vite is on :5173; harmless in prod)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def build_lc_messages(messages):
    lc_messages = []
    for msg in messages:
        if msg.role == "user":
            lc_messages.append(HumanMessage(content=msg.content))
        elif msg.role == "assistant":
            if msg.toolCalls:
                tool_calls_list = []
                for tc in msg.toolCalls:
                    tool_calls_list.append({
                        "name": tc.tool,
                        "args": tc.args,
                        "id": tc.id,
                        "type": "tool_call"
                    })
                lc_messages.append(AIMessage(content=msg.content, tool_calls=tool_calls_list))
                for tc in msg.toolCalls:
                    if tc.result is not None:
                        lc_messages.append(ToolMessage(content=tc.result, tool_call_id=tc.id, name=tc.tool))
            else:
                lc_messages.append(AIMessage(content=msg.content))
        elif msg.role == "system":
            lc_messages.append(SystemMessage(content=msg.content))
    return lc_messages


@app.get("/health")
async def health_check():
    """Check connection to the local Ollama instance."""
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(f"{settings.ollama_base_url}/api/tags", timeout=5.0)
            if response.status_code == 200:
                tags_data = response.json()
                models = [model["name"] for model in tags_data.get("models", [])]
                return {
                    "status": "healthy",
                    "ollama": "connected",
                    "available_models": models
                }
            else:
                return {
                    "status": "degraded",
                    "ollama": "unreachable",
                    "detail": f"Ollama returned HTTP status {response.status_code}"
                }
        except Exception as e:
            return {
                "status": "unhealthy",
                "ollama": "disconnected",
                "error": str(e)
            }


@app.post("/chat")
async def chat_endpoint(request: ChatRequest):
    """Direct multi-turn chat completion using LangChain ChatOllama with streaming."""
    model_name = request.model or settings.default_model
    try:
        llm = ChatOllama(
            base_url=settings.ollama_base_url,
            model=model_name,
            temperature=request.temperature
        )

        lc_messages = build_lc_messages(request.messages)

        async def event_generator():
            async for chunk in llm.astream(lc_messages):
                yield chunk.content

        return StreamingResponse(event_generator(), media_type="text/plain")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ollama chat error: {str(e)}")


@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            payload = await websocket.receive_text()
            try:
                data = json.loads(payload)
                request = ChatRequest(**data)
            except Exception as e:
                await websocket.send_text(json.dumps({"type": "error", "detail": f"Invalid payload: {str(e)}"}))
                continue

            model_name = request.model or settings.default_model
            try:
                llm = ChatOllama(
                    base_url=settings.ollama_base_url,
                    model=model_name,
                    temperature=request.temperature
                )
                model_with_tools = llm.bind_tools([calculate, websearch, python_interpreter])
                
                await websocket.send_text(json.dumps({"type": "start", "model": model_name}))
                
                system_instruction = (
                    "You are Helios, a highly capable AI assistant with access to tools. "
                    "You have access to the following tools:\n"
                    "1. 'calculate' tool: Always call this tool to evaluate mathematical expressions. Do not try to compute math yourself.\n"
                    "2. 'websearch' tool: Call this tool to search the web for current events, real-time facts, or external knowledge.\n"
                    "3. 'python_interpreter' tool: Call this tool to execute Python code in the sandbox. Use this tool whenever the user asks you to write code, solve a programming problem, run a simulation, or process data. "
                    "CRITICAL: When you use the 'python_interpreter' tool, write the code inside the tool call. Do not write the code block in the chat response. "
                    "After you run the tool, write a concise summary of the code and its execution results in the chat window. Do not repeat the code block in your chat message, as the user can see it directly in their sandbox panel.\n"
                    "CRITICAL: If you decide to call a tool, you must generate the tool call immediately without any preceding conversational text, pre-explanations, or comments. "
                    "Never explain what you are going to do before calling a tool. Call it first, and only explain after you receive the tool results. "
                    "Whenever you use search results, synthesize the final answer and cite your sources by referencing their URL inline, e.g. [Source Title](url). "
                    "Never hallucinate URLs; only use the exact URLs returned in the search results."
                )
                
                lc_messages = [SystemMessage(content=system_instruction)] + build_lc_messages(request.messages)
                
                start_time = None
                first_token_time = None
                token_count = 0
                active_tools = {}
                
                while True:
                    generation_start = time.perf_counter()
                    generation_first_token = None
                    generation_token_count = 0
                    
                    full_message = None
                    async for chunk in model_with_tools.astream(lc_messages):
                        if full_message is None:
                            full_message = chunk
                        else:
                            full_message += chunk
                        
                        # Stream text token only if we don't have tool calls yet
                        if chunk.content and not (full_message.tool_calls or getattr(full_message, "tool_call_chunks", [])):
                            if generation_first_token is None:
                                generation_first_token = time.perf_counter()
                            generation_token_count += 1
                            await websocket.send_text(json.dumps({"type": "token", "content": chunk.content}))

                        # If we have tool call chunks, check if it's the python_interpreter tool
                        if getattr(chunk, "tool_call_chunks", None):
                            for tc_chunk in chunk.tool_call_chunks:
                                idx = tc_chunk.get("index", 0)
                                if tc_chunk.get("name"):
                                    active_tools[idx] = tc_chunk["name"]
                                
                                if active_tools.get(idx) == "python_interpreter":
                                    args_val = tc_chunk.get("args")
                                    if args_val:
                                        await websocket.send_text(json.dumps({
                                            "type": "sandbox_stream",
                                            "content": args_val
                                        }))
                    
                    if full_message and not full_message.tool_calls:
                        content_str = full_message.content or ""
                        if "<function=" in content_str:
                            import re
                            func_match = re.search(r"<function=(.*?)>", content_str)
                            if func_match:
                                tool_name = func_match.group(1).strip()
                                kwargs = {}
                                if tool_name == "python_interpreter":
                                    code_match = re.search(r"```(?:python|py)\n([\s\S]*?)```", content_str)
                                    if code_match:
                                        kwargs["code"] = code_match.group(1).strip()
                                    else:
                                        param_match = re.search(r"<parameter=code>\n([\s\S]*?)(?:</parameter>|$)", content_str)
                                        if param_match:
                                            kwargs["code"] = param_match.group(1).strip()
                                            
                                import uuid
                                full_message.tool_calls = [{
                                    "name": tool_name,
                                    "args": kwargs,
                                    "id": "call_" + str(uuid.uuid4()).replace("-", "")[:8]
                                }]

                    if full_message and full_message.tool_calls:
                        for tool_call in full_message.tool_calls:
                            tool_name = tool_call["name"]
                            tool_args = tool_call["args"]
                            tool_id = tool_call["id"]
                            
                            await websocket.send_text(json.dumps({
                                "type": "tool_start",
                                "tool": tool_name,
                                "args": tool_args,
                                "id": tool_id
                            }))
                            
                            # Execute the tool
                            if tool_name == "calculate":
                                result = calculate.invoke(tool_args)
                            elif tool_name == "websearch":
                                result = websearch.invoke(tool_args)
                            elif tool_name == "python_interpreter":
                                result = python_interpreter.invoke(tool_args)
                            else:
                                result = f"Error: Tool '{tool_name}' not found."
                                
                            await websocket.send_text(json.dumps({
                                "type": "tool_result",
                                "tool": tool_name,
                                "result": result,
                                "id": tool_id
                            }))
                            
                            lc_messages.append(full_message)
                            lc_messages.append(ToolMessage(content=result, tool_call_id=tool_id, name=tool_name))
                        
                        # Loop back to model
                        continue
                    else:
                        generation_end = time.perf_counter()
                        start_time = generation_start
                        first_token_time = generation_first_token
                        token_count = generation_token_count
                        end_time = generation_end
                        break
                
                # Send benchmark metrics if text response was generated
                if token_count > 0 and first_token_time is not None:
                    ttft_ms = (first_token_time - start_time) * 1000
                    total_latency_s = end_time - start_time
                    generation_time_s = end_time - first_token_time
                    tokens_per_sec = token_count / generation_time_s if generation_time_s > 0 else 0.0
                    
                    benchmarks = {
                        "ttft_ms": round(ttft_ms, 2),
                        "total_latency_s": round(total_latency_s, 2),
                        "tokens_per_sec": round(tokens_per_sec, 2),
                        "token_count": token_count
                    }
                    await websocket.send_text(json.dumps({"type": "benchmarks", "metrics": benchmarks}))
                
                await websocket.send_text(json.dumps({"type": "done"}))
            except Exception as e:
                await websocket.send_text(json.dumps({"type": "error", "detail": f"Ollama chat error: {str(e)}"}))
    except WebSocketDisconnect:
        return


# ── Python Sandbox endpoints ──────────────────────────────────────────────────

SANDBOX_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "sandbox")

class SandboxExecuteRequest(BaseModel):
    code: str
    files: Optional[Dict[str, str]] = None

@app.post("/sandbox/execute")
async def sandbox_execute(request: SandboxExecuteRequest):
    os.makedirs(SANDBOX_DIR, exist_ok=True)
    
    # Write files if provided
    if request.files:
        for file_name, content in request.files.items():
            safe_path = os.path.abspath(os.path.join(SANDBOX_DIR, file_name))
            if not safe_path.startswith(os.path.abspath(SANDBOX_DIR)):
                raise HTTPException(status_code=400, detail="Invalid file path (directory traversal detected)")
            os.makedirs(os.path.dirname(safe_path), exist_ok=True)
            with open(safe_path, "w", encoding="utf-8") as f:
                f.write(content)
                
    # Always write the main code to main.py
    main_py = os.path.join(SANDBOX_DIR, "main.py")
    with open(main_py, "w", encoding="utf-8") as f:
        f.write(request.code)
        
    python_bin = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "venv", "Scripts", "python.exe")
    if not os.path.exists(python_bin):
        python_bin = "python"
        
    try:
        result = subprocess.run(
            [python_bin, "main.py"],
            cwd=SANDBOX_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=15.0
        )
        return {
            "stdout": result.stdout,
            "stderr": result.stderr,
            "exit_code": result.returncode
        }
    except subprocess.TimeoutExpired as e:
        return {
            "stdout": e.stdout or "",
            "stderr": (e.stderr or "") + "\nTimeoutExpired: Code execution exceeded 15 seconds limit.",
            "exit_code": -1
        }
    except Exception as e:
        return {
            "stdout": "",
            "stderr": f"Execution failed: {str(e)}",
            "exit_code": -1
        }

@app.get("/sandbox/files")
async def sandbox_files():
    if not os.path.exists(SANDBOX_DIR):
        return []
    
    file_list = []
    for root, dirs, files in os.walk(SANDBOX_DIR):
        for file in files:
            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, SANDBOX_DIR)
            size = os.path.getsize(full_path)
            file_list.append({
                "name": rel_path.replace("\\", "/"),
                "sizeBytes": size
            })
    file_list.sort(key=lambda x: x["name"])
    return file_list

@app.post("/sandbox/clear")
async def sandbox_clear():
    if os.path.exists(SANDBOX_DIR):
        try:
            for item in os.listdir(SANDBOX_DIR):
                item_path = os.path.join(SANDBOX_DIR, item)
                if os.path.isdir(item_path):
                    shutil.rmtree(item_path)
                else:
                    os.remove(item_path)
            return {"status": "success", "detail": "Workspace cleared"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to clear workspace: {str(e)}")
    return {"status": "success", "detail": "Workspace already empty"}


# ── Static frontend (production) ──────────────────────────────────────────────
# In development: run `npm run dev` in frontend/ — Vite serves on :5173 and
#                 proxies /health, /chat, /ws/chat to this FastAPI server.
# In production:  run `npm run build` in frontend/ then start this server.
#                 FastAPI serves the compiled assets from frontend/dist/.

_DIST = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend", "dist")

if os.path.isdir(_DIST):
    # Mount static assets (JS, CSS, images …)
    app.mount("/assets", StaticFiles(directory=os.path.join(_DIST, "assets")), name="assets")

    @app.get("/{full_path:path}", response_class=HTMLResponse)
    async def serve_spa(full_path: str):
        """Catch-all: serve index.html so React Router (if used) handles routes."""
        index = os.path.join(_DIST, "index.html")
        return FileResponse(index)
