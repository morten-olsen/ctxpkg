# Context Stacking: How Sarah Automated Her Team's Brain with ctxpkg

_Note: The following is a fictional scenario. It represents the "North Star" vision for `ctxpkg`—a story about how I imagine this tool will change our daily workflows once fully realized._

Let me introduce you to Sarah. Sarah is a fictional Senior Developer at a fictional mid-sized fintech company. She doesn't exist, but her problems definitely do. She is brilliant, tired, and deeply skeptical of tools that promise to "do it all for you."

Like many of us, Sarah has integrated AI into her workflow. But she hit a wall. Every time she started a new chat session, she found herself pasting the same three paragraphs:

_"We use Python 3.11 with Ruff for linting. We use Conventional Commits. Do not suggest `os.path`, use `pathlib`. Oh, and here is how we handle authentication in our proprietary gateway..."_

It was the "Groundhog Day" of prompting. She needed a way to package this context so her AI assistant knew _her_, knew her _team_, and knew her _company_, without her having to explain it every single morning.

This is where she turned to **ctxpkg**.

## The Hierarchy of Context

Sarah realized that "context" isn't a flat list of files. It’s a hierarchy. She visualized it in four distinct layers:

1.  **The Personal Layer:** Her private notes, snippets, and "second brain."
2.  **The Project Layer:** The specific architecture, setup guides, and domain logic for the current repository.
3.  **The Team Layer:** The squad's agreed-upon patterns, commit styles, and Jira workflows.
4.  **The Global Layer:** Company-wide security mandates and public library documentation.

Here is how she used `ctxpkg` to automate the distribution of this knowledge.

### Layer 1: The Personal "Second Brain"

Sarah lives in Obsidian. Over the years, she has accumulated a vault of solutions: specific SQL optimization tricks, snippets for obscure Bash commands, and notes on how she likes her unit tests structured.

She didn't want to upload this to a public repo, but she wanted her local AI agent to have access to it.

She created a simple `context.manifest.json` in the root of her Obsidian vault:

```json
{
  "name": "sarah-brain",
  "version": "1.0.0",
  "description": "Sarah's personal collection of coding notes and snippets",
  "sources": {
    "glob": ["Development/Snippets/**/*.md", "Reference/Cheatsheets/*.md"]
  }
}
```

Then, she registered it locally as a global package:

```bash
ctxpkg col add -g sarah-brain file:///Users/sarah/Documents/ObsidianVault/context.manifest.json
```

Now, regardless of what project she is working on, she can simply ask: _"How did I solve that postgres locking issue last year?"_ and the agent pulls from her personal notes.

### Layer 2: The Project Context

Before looking outward to the team or company, Sarah needed her agent to understand the _here and now_.

The repository she was working on, `payment-gateway`, had its own `./docs` folder containing architecture diagrams, specific business rules for handling currencies, and the local developer setup guide.

She didn't need to distribute this; it lived with the code. She simply pointed `ctxpkg` to it:

```bash
ctxpkg col add docs ./docs/manifest.json
```

This was crucial. When she asked _"Where is the entry point for the transaction processor?"_, the agent didn't guess based on generic patterns—it found the specific `architecture.md` file in the repo and gave her the exact file path and line number.

### Layer 3: The Team Alignment

This is where things usually fall apart. We've all been there: The team agrees on a "Way of Working" document, it gets committed to a wiki, and is never read again.

Sarah's team, "Team Rocket," decided to codify their culture. They created a git repository called `rocket-context` containing their guidelines.

Crucially, this included their commit message standard. They wanted uniformed history, but nobody could remember if it was `feat(scope):` or `feat: (scope)`.

They added a `context.manifest.json` to the repo and pushed it.

Now, when Sarah initializes a new feature branch, she ensures the project's `context.json` includes the team package:

```json
{
  "collections": {
    "team-rocket": {
      "url": "https://github.com/acme/rocket-context/releases/latest/download/rocket-context.tar.gz"
    }
  }
}
```

**The Result?**
When Sarah finishes a task, she doesn't write the commit message. She runs her agent (via the CLI or her IDE) and says _"Commit these changes."_

The agent searches the index for "commit message standards", retrieves the Conventional Commits guide from `team-rocket`, reads the diff, and generates:

```text
feat(auth): implement JWT rotation based on RFC-xyz

- Adds rotation logic to AuthProvider
- Updates user session schema
```

No friction. Perfect consistency.

#### The Jira Integration

Sarah already had a Jira MCP (Model Context Protocol) server configured in her editor, giving her agent access to the board. But access isn't intelligence. When she asked _"What should I work on next?"_, it would simply list the tickets in the backlog.

The magic happened when she added the `team-rocket` context.

This package didn't contain the Jira connection; it contained the **logic**—the "Way of Working" document that states: _"Critical security bugs must always be prioritized over new features, regardless of sprint planning."_

Now, the agent could combine the _data_ from the Jira MCP with the _wisdom_ from `ctxpkg`.

```bash
# Sarah's prompt
"What should I work on next?"

# The Agent's process
1. Tools: Queries Jira MCP for tickets assigned to Sarah.
2. Context: Retrieves 'Prioritization Policy' from the team-rocket package.
3. Reasoning: Identifies a security ticket that overrides the planned feature work.
```

The agent replies: _"Based on the team's security-first policy, you should tackle **PROJ-102: API Rate Limiting**. It's the highest priority item in the sprint."_

### Layer 4: The Corporate & Public Standards

Finally, there's the stuff you can't change. The company has strict guidelines on Kubernetes deployments, and they use a specific version of Python.

Plus, Sarah is using `FastAPI` and `Pydantic`. While popular, LLMs often hallucinate outdated syntax for these rapidly evolving libraries.

Sarah updates her project's `context.json` one last time to stack these final layers:

```json
{
  "collections": {
    "team-rocket": {
      "url": "https://github.com/acme/rocket-context/releases/latest/download/rocket-context.tar.gz"
    },
    "python-standards": {
      "url": "https://github.com/acme/python-standards/releases/latest/download/python-standards.tar.gz"
    },
    "fastapi": {
      "url": "https://github.com/fastapi/fastapi/releases/download/0.109.0/docs.tar.gz"
    },
    "pydantic": {
      "url": "https://github.com/pydantic/pydantic/releases/download/v2.5.0/docs.tar.gz"
    }
  }
}
```

### The Glue: Commanding the Agent

You might be wondering: How does the agent _know_ to search for these things? It doesn't happen by magic.

`ctxpkg` is the library, but the agent needs a library card. Sarah added a file to the project root—often called `AGENTS.md` or `.cursorrules`—that serves as the standing orders:

```markdown
# Agent Guidelines

1. **Commits**: Before creating a commit, search for our current commit practices.
2. **Coding**: Search for relevant team standards and patterns before writing code.
3. **Planning**: Check our agreed prioritization rules before selecting tasks.
```

This small instruction file ensures the agent proactively queries the context engine instead of guessing or relying on its training data.

### The "Downsides" (and how to mitigate them)

Let's look at the challenges involved. Stacking this much context has a cost.

1.  **Token Windows:** Even with large context windows, dumping an entire Obsidian vault and three documentation libraries into the prompt is inefficient and expensive.
2.  **Confusion:** Sometimes, personal notes might conflict with company standards.

This is why `ctxpkg`'s **semantic search** is critical. It doesn't dump _everything_. When Sarah asks about "Deploying the auth service," `ctxpkg`:

1.  Searches `python-standards` for deployment rules.
2.  Searches `sarah-brain` for her specific notes on this service.
3.  Ignores the Pydantic documentation entirely for that turn.

### The New Developer Experience

The true test of this system came when Sarah hired Tim, a junior developer.

On Tim's first day, he didn't have to spend 4 hours reading outdated wikis. He cloned the repo, ran `ctxpkg col sync`, and opened his editor.

When he asked the AI: _"How do I add a new endpoint?"_

The AI didn't give him a generic StackOverflow answer. It gave him:

1.  The specific folder structure Team Rocket uses (from `team-rocket`).
2.  The required security decorators (from `python-standards`).
3.  A reminder to update the OpenAPI schema (from the project context).

Tim was pushing production-ready code on Day 2.

## Conclusion

We treat our code as a first-class citizen—versioned, managed, and distributed. It is time we treat our **context** the same way.

By layering her context with `ctxpkg`, Sarah moved from "prompt engineering" to "context engineering." She isn't fighting the AI anymore; she's just working, and the AI is finally keeping up.
