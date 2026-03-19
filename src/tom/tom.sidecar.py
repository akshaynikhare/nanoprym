#!/usr/bin/env python3
"""
Nanoprym TOM (Token Optimization Module) — Python Sidecar
3-layer compression pipeline + LLM router
Communicates with Node.js orchestrator via Unix socket
"""

import asyncio
import json
import os
import socket
import sys
from pathlib import Path

# Socket path
SOCKET_PATH = os.environ.get("TOM_SOCKET", "/tmp/nanoprym-tom.sock")

# ── Layer 1: Static Rule Engine ──────────────────────────────

FILLER_WORDS = {
    "please", "kindly", "basically", "essentially", "actually",
    "really", "very", "quite", "just", "simply", "somewhat",
}

PHRASE_REPLACEMENTS = {
    "in order to": "to",
    "due to the fact that": "because",
    "at this point in time": "now",
    "in the event that": "if",
    "for the purpose of": "to",
    "with regard to": "about",
    "i would like you to": "",
    "can you please": "",
    "could you please": "",
    "would you mind": "",
}


def compress_rules(text: str) -> str:
    """Layer 1: Static rule-based compression."""
    result = text

    # Phrase replacements (case-insensitive)
    for phrase, replacement in PHRASE_REPLACEMENTS.items():
        import re
        result = re.sub(re.escape(phrase), replacement, result, flags=re.IGNORECASE)

    # Filler word removal (word boundaries, preserve code blocks)
    # TODO: Implement code block preservation
    words = result.split()
    words = [w for w in words if w.lower().strip(".,!?;:") not in FILLER_WORDS]
    result = " ".join(words)

    # Whitespace normalization
    result = " ".join(result.split())

    return result.strip()


# ── Layer 2: spaCy NLP (loaded lazily) ───────────────────────

_nlp = None

def get_nlp():
    """Lazy-load spaCy model."""
    global _nlp
    if _nlp is None:
        try:
            import spacy
            _nlp = spacy.load("en_core_web_sm")
        except (ImportError, OSError):
            print("[TOM] spaCy not available, Layer 2 disabled", file=sys.stderr)
            _nlp = False
    return _nlp if _nlp else None


def compress_spacy(text: str) -> str:
    """Layer 2: spaCy NLP compression."""
    nlp = get_nlp()
    if nlp is None:
        return text

    # TODO: Phase 2 Week 3 — Implement entity-aware compression
    # - NER: preserve names, dates, amounts, URLs
    # - Dependency parsing: remove adverbial modifiers
    # - Sentence simplification
    return text


# ── Layer 3: Template Cache ──────────────────────────────────

_cache: dict[str, str] = {}

def compress_cache(text: str) -> tuple[str, bool]:
    """Layer 3: Template deduplication cache."""
    import hashlib
    key = hashlib.sha256(text.encode()).hexdigest()
    if key in _cache:
        return _cache[key], True
    return text, False


# ── Pipeline ─────────────────────────────────────────────────

def compress(text: str, layers: list[str] | None = None) -> dict:
    """Run full compression pipeline."""
    if layers is None:
        layers = ["rules", "spacy", "cache"]

    original_len = len(text)
    result = text
    layers_applied = []

    if "rules" in layers:
        result = compress_rules(result)
        layers_applied.append("rules")

    if "spacy" in layers:
        result = compress_spacy(result)
        layers_applied.append("spacy")

    cache_hit = False
    if "cache" in layers:
        result, cache_hit = compress_cache(result)
        if cache_hit:
            layers_applied.append("cache-hit")
        else:
            # Store in cache
            import hashlib
            key = hashlib.sha256(text.encode()).hexdigest()
            _cache[key] = result
            layers_applied.append("cache-miss")

    compressed_len = len(result)
    ratio = 1.0 - (compressed_len / original_len) if original_len > 0 else 0.0

    return {
        "text": result,
        "original_chars": original_len,
        "compressed_chars": compressed_len,
        "ratio": round(ratio, 4),
        "layers": layers_applied,
        "cache_hit": cache_hit,
    }


# ── Unix Socket Server ───────────────────────────────────────

async def handle_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    """Handle a single client connection."""
    try:
        while True:
            data = await reader.readline()
            if not data:
                break

            request = json.loads(data.decode())
            action = request.get("action", "compress")

            if action == "compress":
                result = compress(request["text"], request.get("layers"))
                response = {"ok": True, **result}
            elif action == "ping":
                response = {"ok": True, "status": "running"}
            elif action == "stats":
                response = {"ok": True, "cache_size": len(_cache)}
            else:
                response = {"ok": False, "error": f"Unknown action: {action}"}

            writer.write(json.dumps(response).encode() + b"\n")
            await writer.drain()
    except Exception as e:
        print(f"[TOM] Client error: {e}", file=sys.stderr)
    finally:
        writer.close()


async def main():
    """Start the TOM sidecar Unix socket server."""
    # Clean up old socket
    if os.path.exists(SOCKET_PATH):
        os.unlink(SOCKET_PATH)

    server = await asyncio.start_unix_server(handle_client, path=SOCKET_PATH)
    os.chmod(SOCKET_PATH, 0o660)

    print(f"[TOM] Sidecar listening on {SOCKET_PATH}", file=sys.stderr)

    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
