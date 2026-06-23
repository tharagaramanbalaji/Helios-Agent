from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, StreamingResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from langchain_ollama import ChatOllama
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, ToolMessage
from app.agent import calculate, websearch

from app.config import settings
from app.schemas import ChatRequest, ChatResponse, Message

import httpx
import json
import os
import time

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
                model_with_tools = llm.bind_tools([calculate, websearch])
                
                await websocket.send_text(json.dumps({"type": "start", "model": model_name}))
                
                system_instruction = (
                    "You are Helios, a highly capable AI assistant with access to tools. "
                    "You have access to the following tools:\n"
                    "1. 'calculate' tool: Always call this tool to evaluate mathematical expressions. Do not try to compute math yourself.\n"
                    "2. 'websearch' tool: Call this tool to search the web for current events, real-time facts, or external knowledge. "
                    "Use this tool only when the query requires fresh real-time information or external facts not present in your local knowledge base. "
                    "CRITICAL: If you decide to call a tool, you must generate the tool call immediately without any preceding conversational text, pre-explanations, or comments. "
                    "Never explain what you are going to do before calling a tool. Call it first, and only explain after you receive the tool results. "
                    "Whenever you use search results, synthesize the final answer and cite your sources by referencing their URL inline, e.g. [Source Title](url). "
                    "Never hallucinate URLs; only use the exact URLs returned in the search results."
                )
                
                lc_messages = [SystemMessage(content=system_instruction)] + build_lc_messages(request.messages)
                
                start_time = None
                first_token_time = None
                token_count = 0
                
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
