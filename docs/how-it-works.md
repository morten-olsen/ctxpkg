# How ctxpkg Works

This document explains the technical details of how ctxpkg indexes documents and performs searches.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        CLI / MCP                            │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend Services                         │
│                                                             │
│   Collections    Documents    Search    Embedder            │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    SQLite Database                          │
│                                                             │
│   • Vector embeddings (sqlite-vec)                          │
│   • Full-text search (FTS5)                                 │
│   • Collection & document metadata                          │
└─────────────────────────────────────────────────────────────┘
```

## Indexing Pipeline

When you sync a collection, documents go through the following pipeline:

```
Document → Token Chunking → Context Enrichment → Embedding → Storage
```

### 1. Token-Based Chunking

Documents are split into chunks of approximately 400 tokens with 80 token overlap:

- Uses the `cl100k_base` tokenizer (same as GPT-4) for accurate token counting
- Overlap preserves context at chunk boundaries
- Chunk size fits within the embedding model's 512-token limit

**Why token-based?** Character or word counts don't correlate well with model context limits. Token-based chunking ensures consistent chunk sizes that work well with both the embedding model and downstream LLMs.

### 2. Context Enrichment

Each chunk is enriched with document context before embedding:

```
Document: {document title}
Section: {nearest heading}

{chunk content}
```

This contextual prefix helps the embedding model understand what each chunk is about, significantly improving retrieval accuracy for chunks that would otherwise lack context.

### 3. Embedding

Chunks are embedded using the `mixedbread-ai/mxbai-embed-large-v1` model:

| Property | Value |
|----------|-------|
| Dimensions | 1024 |
| Max tokens | 512 |
| Approach | Instruction-based |

**Instruction-based embeddings** use different prompts for indexing vs searching:
- **Indexing:** "Represent this document for retrieval: {text}"
- **Searching:** "Represent this query for retrieval: {query}"

This asymmetric approach improves retrieval quality.

The model runs locally via transformers.js — no API calls or data leaves your machine.

### 4. Storage

Indexed data is stored in a local SQLite database with two search indexes:

| Index | Technology | Purpose |
|-------|------------|---------|
| Vector | sqlite-vec | Semantic similarity search |
| Full-text | FTS5 | Keyword/term matching |

Vectors are stored as JSON-serialized arrays and queried using cosine distance.

## Search Pipeline

When you search, queries go through a multi-stage pipeline:

```
Query → Query Embedding → Hybrid Search → Rank Fusion → Results
         (optional: Re-ranking)
```

### 1. Query Embedding

The search query is embedded using the same model as indexing, but with the search instruction prefix.

### 2. Hybrid Search

By default, queries run against both indexes simultaneously:

| Method | What It Finds | Algorithm |
|--------|---------------|-----------|
| Vector search | Semantically similar content | Cosine distance |
| Keyword search | Exact term matches | BM25 (via FTS5) |

**Why hybrid?** Vector search excels at finding conceptually related content but can miss exact matches. Keyword search finds precise terms but misses synonyms and paraphrases. Combining both gives better results than either alone.

### 3. Reciprocal Rank Fusion (RRF)

Results from both search methods are merged using Reciprocal Rank Fusion:

```
RRF_score(d) = Σ 1 / (k + rank(d))
```

Where `k` is a constant (typically 60) and `rank(d)` is the document's position in each result list.

RRF combines rankings without requiring score normalization — documents appearing in both result sets get boosted naturally.

### 4. Re-ranking (Optional)

With the `--rerank` flag, top candidates are re-scored using a cross-encoder model for higher precision. This is slower but more accurate for complex queries.

## Understanding Search Results

```
1. getting-started.md in project-docs
   Score: 0.0327 | Distance: 0.4521
```

| Metric | Meaning | Good Values |
|--------|---------|-------------|
| **Distance** | Cosine distance (0 = identical, 2 = opposite) | < 0.5 excellent, < 1.0 relevant |
| **Score** | Combined RRF ranking score | Higher = better match |

### Distance Guidelines

| Distance | Interpretation |
|----------|----------------|
| 0.0 - 0.3 | Very strong match |
| 0.3 - 0.5 | Strong match |
| 0.5 - 0.8 | Moderate match |
| 0.8 - 1.0 | Weak match |
| > 1.0 | Poor match / likely irrelevant |

Use `--max-distance` to filter out low-quality matches:

```bash
ctxpkg docs search "authentication" --max-distance 0.8
```

## Performance Considerations

### First Sync

The first sync downloads the embedding model (~500MB). This is a one-time cost — the model is cached locally.

### Incremental Sync

Subsequent syncs only process changed files:
- File hashes are compared against the database
- Unchanged files are skipped
- Only modified/new documents are re-embedded

### Daemon Mode

For better performance, run the daemon:

```bash
ctxpkg daemon start
```

The daemon keeps the database connection pool and embedding model loaded in memory, eliminating startup overhead for each command.

## Data Storage

### Database Location

The SQLite database is stored at:
- **Linux/macOS:** `~/.local/share/ctxpkg/ctxpkg.db`
- **Windows:** `%APPDATA%\ctxpkg\ctxpkg.db`

### What's Stored

| Data | Purpose |
|------|---------|
| Collection metadata | URL, sync status, version |
| Document metadata | Path, hash, title, collection |
| Chunks | Text content, position, parent document |
| Embeddings | 1024-dim vectors for each chunk |
| FTS index | Tokenized text for keyword search |

### Privacy

All processing happens locally:
- Documents are never sent to external services
- Embeddings are generated on your machine
- The database stays on your filesystem

## Limitations

### Context Window

While ctxpkg reduces what needs to go into prompts, very large result sets can still overwhelm context windows. Use `--limit` and `--max-distance` to control result size.

### Document Types

Currently optimized for Markdown documents. Other text formats work but may not chunk as intelligently (e.g., heading detection is Markdown-specific).

### Embedding Model

The default model (`mxbai-embed-large-v1`) is general-purpose. Highly specialized domains (legal, medical) may benefit from domain-specific models — this is not yet configurable.

## See Also

- [Configuration Guide](./configuration.md) — Database and sync settings
- [MCP Server](./mcp-server.md) — How AI editors connect to ctxpkg
