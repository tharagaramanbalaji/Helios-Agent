from typing import TypedDict, Annotated, Sequence
from langchain_core.messages import BaseMessage, SystemMessage, HumanMessage, AIMessage
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langchain_ollama import ChatOllama
from app.config import settings
import math
import subprocess
import os
from langchain_core.tools import tool

@tool
def calculate(expression: str) -> str:
    """Useful for evaluating mathematical expressions. Input must be a valid python math expression, e.g. '2 + 2 * 3' or 'math.sqrt(144)'."""
    try:
        # Create a restricted environment containing only safe math constants & functions
        allowed_names = {k: v for k, v in math.__dict__.items() if not k.startswith("__")}
        allowed_names.update({
            "math": math,
            "abs": abs,
            "round": round
        })
        
        # Safely evaluate
        result = eval(expression, {"__builtins__": {}}, allowed_names)
        return str(result)
    except Exception as e:
        return f"Error evaluating expression: {str(e)}"

@tool
def python_interpreter(code: str) -> str:
    """Execute Python code in a local sandbox environment and return the standard output/errors.
    Use this tool whenever you need to run Python scripts to write programs, solve coding tasks, process data, or perform computations.
    Input must be valid Python code. Output results to stdout by using print() to see them."""
    
    sandbox_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "sandbox")
    os.makedirs(sandbox_dir, exist_ok=True)
    
    main_py = os.path.join(sandbox_dir, "main.py")
    try:
        with open(main_py, "w", encoding="utf-8") as f:
            f.write(code)
    except Exception as e:
        return f"Error writing file: {str(e)}"
        
    python_bin = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "venv", "Scripts", "python.exe")
    if not os.path.exists(python_bin):
        python_bin = "python"
        
    try:
        result = subprocess.run(
            [python_bin, "main.py"],
            cwd=sandbox_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=15.0
        )
        output = ""
        if result.stdout:
            output += result.stdout
        if result.stderr:
            output += f"\nErrors:\n{result.stderr}"
        if not output:
            output = f"[Executed successfully with exit code {result.returncode}, but produced no stdout/stderr]"
        return output
    except subprocess.TimeoutExpired as e:
        return f"TimeoutExpired: Code execution exceeded 15 seconds limit. Output:\n{e.stdout or ''}\nErrors:\n{e.stderr or ''}"
    except Exception as e:
        return f"Execution failed: {str(e)}"

import httpx
import json

@tool
def websearch(query: str) -> str:
    """Search the web for real-time information or news on a query.
    Use this tool only when the query requires current events, real-time facts, or external information not present in your local knowledge base."""
    api_key = settings.you_api_key
    if not api_key:
        return "Error: You.com Search API key is not configured in settings."
        
    try:
        url = "https://ydc-index.io/v1/search"
        headers = {"X-API-Key": api_key}
        # Limit count to 3 to minimize credit usage as requested by the user
        params = {"query": query, "count": 3}
        
        response = httpx.get(url, headers=headers, params=params, timeout=10.0)
        if response.status_code != 200:
            return f"Error: Search API returned status code {response.status_code}"
            
        data = response.json()
        results = []
        web_results = data.get("results", {}).get("web", [])
        
        for item in web_results:
            results.append({
                "title": item.get("title", ""),
                "url": item.get("url", ""),
                "snippets": item.get("snippets", [])
            })
            
        if not results:
            return "No web search results found."
            
        return json.dumps(results)
    except Exception as e:
        return f"Error performing web search: {str(e)}"

# Define the State representing the graph context
class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]
    category: str
    response: str
    model: str
    temperature: float

# Node 1: Analyze user input and classify into a category
def analyze_node(state: AgentState) -> dict:
    model_name = state.get("model") or settings.default_model
    llm = ChatOllama(
        base_url=settings.ollama_base_url,
        model=model_name,
        temperature=0.0  # Zero temperature for deterministic classification
    )
    
    # Get the last human query
    human_messages = [msg for msg in state["messages"] if isinstance(msg, HumanMessage)]
    last_query = human_messages[-1].content if human_messages else ""
    
    system_prompt = (
        "You are a router. Categorize the user request into exactly one of these categories: 'coding', 'analytical', or 'conversational'. "
        "Your reply must contain ONLY the category name as a single word in lowercase. Do not explain, do not add punctuation."
    )
    
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=f"Query to classify: {last_query}")
    ]
    
    try:
        response = llm.invoke(messages)
        category = response.content.strip().lower()
    except Exception as e:
        # Fallback if connection or model fails
        category = "conversational"
    
    # Sanitize category output
    valid_categories = {"coding", "analytical", "conversational"}
    if category not in valid_categories:
        for cat in valid_categories:
            if cat in category:
                category = cat
                break
        else:
            category = "conversational"
            
    return {"category": category}

# Node 2: Respond to user query using custom system prompt based on category
def respond_node(state: AgentState) -> dict:
    model_name = state.get("model") or settings.default_model
    temp = state.get("temperature", 0.7)
    llm = ChatOllama(
        base_url=settings.ollama_base_url,
        model=model_name,
        temperature=temp
    )
    
    category = state.get("category", "conversational")
    
    # Get user message history
    human_messages = [msg for msg in state["messages"] if isinstance(msg, HumanMessage)]
    last_query = human_messages[-1].content if human_messages else ""
    
    # Tailor prompt instructions
    if category == "coding":
        instruction = (
            "You are an expert software developer. Provide clean, well-formatted code blocks with syntax highlighting. "
            "Write helpful comments and explain your logic concisely."
        )
    elif category == "analytical":
        instruction = (
            "You are an analytical assistant. Provide a structured, step-by-step breakdown. "
            "Use bullet points, lists, and bold text for clarity and logic."
        )
    else:
        # Conversational fallback
        instruction = (
            "You are a friendly and helpful assistant. Respond warm, naturally, and conversationally."
        )
        
    messages = [
        SystemMessage(content=instruction),
        HumanMessage(content=last_query)
    ]
    
    try:
        response = llm.invoke(messages)
        reply_content = response.content
    except Exception as e:
        reply_content = f"Failed to generate response: {str(e)}"
        response = AIMessage(content=reply_content)
        
    return {
        "response": reply_content,
        "messages": [response]
    }

# Construct the LangGraph workflow
builder = StateGraph(AgentState)

# Add nodes to graph
builder.add_node("analyzer", analyze_node)
builder.add_node("responder", respond_node)

# Set up flow (edges)
builder.add_edge(START, "analyzer")
builder.add_edge("analyzer", "responder")
builder.add_edge("responder", END)

# Compile graph
agent_graph = builder.compile()
