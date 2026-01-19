# AI Editor Setup Guide

This guide covers how to configure various AI editors and tools to use ctxpkg's MCP server for accessing your documentation.

## Quick Setup Summary

| Editor          | Setup Method | Command                                                |
| --------------- | ------------ | ------------------------------------------------------ |
| **Cursor**      | Config file  | `npx -y ctxpkg mcp documents`                          |
| **Claude Code** | CLI command  | `claude mcp add ctxpkg -- npx -y ctxpkg mcp documents` |
| **Opencode**    | Config file  | `npx -y ctxpkg mcp documents`                          |

<details>
<summary>🔧 Cursor</summary>

### Configuration

Add to `~/.cursor/mcp.json` (for global setup) or `.cursor/mcp.json` (for project-specific setup):

```json
{
  "mcpServers": {
    "ctxpkg": {
      "command": "npx",
      "args": ["-y", "ctxpkg", "mcp", "documents"]
    }
  }
}
```

### Agent Mode (Reduced Token Usage)

For long conversations, use Agent Mode to reduce token costs:

```json
{
  "mcpServers": {
    "ctxpkg-agent": {
      "command": "npx",
      "args": ["-y", "ctxpkg", "mcp", "agent"]
    }
  }
}
```

### Verification

1. Restart Cursor
2. Open a new chat
3. Ask: "What documentation collections are available?"
4. You should see ctxpkg tools in the tool panel

[Cursor MCP Documentation](https://docs.cursor.com/context/model-context-protocol)

</details>

<details>
<summary>🤖 Claude Code</summary>

### Installation

Run this command in your terminal:

```bash
claude mcp add ctxpkg -- npx -y ctxpkg mcp documents
```

### Agent Mode

```bash
claude mcp add ctxpkg-agent -- npx -y ctxpkg mcp agent
```

### Verification

1. Open Claude Code
2. Start a new session
3. Check available tools with `claude mcp list`
4. Test with a question about your documentation

[Claude Code MCP Documentation](https://docs.anthropic.com/en/docs/claude-code/mcp)

</details>

<details>
<summary>⚡ Opencode</summary>

### Configuration

Add to your Opencode configuration file:

```json
{
  "mcp": {
    "ctxpkg": {
      "type": "local",
      "command": ["npx", "-y", "ctxpkg", "mcp", "documents"],
      "enabled": true
    }
  }
}
```

### Agent Mode

```json
{
  "mcp": {
    "ctxpkg-agent": {
      "type": "local",
      "command": ["npx", "-y", "ctxpkg", "mcp", "agent"],
      "enabled": true
    }
  }
}
```

### Verification

1. Restart Opencode
2. Open a new chat session
3. Test with: "Search my documentation for [topic]"

[Opencode MCP Documentation](https://opencode.ai/docs/mcp-servers)

</details>

---

## Additional AI Editors

<details>
<summary>🔄 VS Code</summary>

Add to your VS Code MCP configuration:

```json
{
  "mcp": {
    "servers": {
      "ctxpkg": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "ctxpkg", "mcp", "documents"]
      }
    }
  }
}
```

[VS Code MCP Documentation](https://code.visualstudio.com/docs/copilot/chat/mcp-servers)

</details>

<details>
<summary>🌊 Windsurf</summary>

Add to your Windsurf MCP config:

```json
{
  "mcpServers": {
    "ctxpkg": {
      "command": "npx",
      "args": ["-y", "ctxpkg", "mcp", "documents"]
    }
  }
}
```

</details>

<details>
<summary>📝 Claude Desktop</summary>

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ctxpkg": {
      "command": "npx",
      "args": ["-y", "ctxpkg", "mcp", "documents"]
    }
  }
}
```

[Claude Desktop MCP Documentation](https://modelcontextprotocol.io/quickstart/user)

</details>

<details>
<summary>⚡ Zed</summary>

Add to `settings.json`:

```json
{
  "context_servers": {
    "ctxpkg": {
      "source": "custom",
      "command": "npx",
      "args": ["-y", "ctxpkg", "mcp", "documents"]
    }
  }
}
```

[Zed Context Server Documentation](https://zed.dev/docs/assistant/context-servers)

</details>

<details>
<summary>🛠️ JetBrains AI Assistant</summary>

1. Go to `Settings` → `Tools` → `AI Assistant` → `Model Context Protocol (MCP)`
2. Click `+ Add`
3. Add this configuration:

```json
{
  "mcpServers": {
    "ctxpkg": {
      "command": "npx",
      "args": ["-y", "ctxpkg", "mcp", "documents"]
    }
  }
}
```

[JetBrains AI Assistant Documentation](https://www.jetbrains.com/help/ai-assistant/configure-an-mcp-server.html)

</details>

---

## Advanced Editors & Tools

<details>
<summary>🔍 OpenAI Codex</summary>

Add to `config.toml`:

```toml
[mcp_servers.ctxpkg]
args = ["-y", "ctxpkg", "mcp", "documents"]
command = "npx"
startup_timeout_ms = 20_000
```

</details>

<details>
<summary>🌟 Google Antigravity</summary>

Add to your Antigravity MCP config:

```json
{
  "mcpServers": {
    "ctxpkg": {
      "command": "npx",
      "args": ["-y", "ctxpkg", "mcp", "documents"]
    }
  }
}
```

</details>

<details>
<summary>🚀 Kilo Code</summary>

Create `.kilocode/mcp.json`:

```json
{
  "mcpServers": {
    "ctxpkg": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "ctxpkg", "mcp", "documents"],
      "alwaysAllow": [],
      "disabled": false
    }
  }
}
```

</details>

<details>
<summary>📚 Kiro</summary>

1. Navigate `Kiro` > `MCP Servers`
2. Click `+ Add`
3. Paste configuration:

```json
{
  "mcpServers": {
    "ctxpkg": {
      "command": "npx",
      "args": ["-y", "ctxpkg", "mcp", "documents"],
      "env": {},
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

</details>

<details>
<summary>🔧 Roo Code</summary>

Add to your Roo Code MCP configuration:

```json
{
  "mcpServers": {
    "ctxpkg": {
      "command": "npx",
      "args": ["-y", "ctxpkg", "mcp", "documents"]
    }
  }
}
```

</details>

<details>
<summary>🐳 Docker</summary>

1. Create a `Dockerfile`:

```Dockerfile
FROM node:18-alpine
WORKDIR /app
RUN npm install -g ctxpkg
CMD ["ctxpkg", "mcp", "documents"]
```

2. Build the image:

```bash
docker build -t ctxpkg-mcp .
```

3. Configure your MCP client:

```json
{
  "mcpServers": {
    "ctxpkg": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "ctxpkg-mcp"],
      "transportType": "stdio"
    }
  }
}
```

</details>

---

## Alternative Runtimes

### Bun

Replace `npx` with `bunx`:

```json
{
  "mcpServers": {
    "ctxpkg": {
      "command": "bunx",
      "args": ["-y", "ctxpkg", "mcp", "documents"]
    }
  }
}
```

### Deno

```json
{
  "mcpServers": {
    "ctxpkg": {
      "command": "deno",
      "args": ["run", "--allow-env", "--allow-net", "npm:ctxpkg", "mcp", "documents"]
    }
  }
}
```

---

## Windows Configuration

On Windows, use `cmd` to run npx:

```json
{
  "mcpServers": {
    "ctxpkg": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "ctxpkg", "mcp", "documents"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

---

## Troubleshooting

### Common Issues

1. **"Command not found"** - Ensure Node.js and npm are installed and in your PATH
2. **"Permission denied"** - Try running with proper permissions or use `sudo` on Unix systems
3. **"Timeout errors"** - Increase timeout settings in your MCP client configuration
4. **"No collections found"** - Make sure you've run `ctxpkg col sync` to index your documents

### Testing Your Setup

1. First, ensure ctxpkg is working:

```bash
ctxpkg col list
ctxpkg docs search "test query"
```

2. Test MCP server manually:

```bash
npx -y ctxpkg mcp documents
```

3. Check your AI editor's logs for MCP connection errors

### Getting Help

- [ctxpkg Documentation](../README.md)
- [MCP Specification](https://modelcontextprotocol.io/)
- [AI Editor Documentation] - Check your specific editor's MCP docs

---

## Best Practices

### Performance

- Use **Agent Mode** (`mcp agent`) for long conversations to reduce token costs
- Run `ctxpkg daemon start` for better performance with frequent queries
- Index documents periodically with `ctxpkg col sync` to keep content fresh

### Security

- Use git+ssh URLs for private repositories: `git+ssh://git@github.com/org/private-repo`
- Store sensitive manifests in private repositories
- Regularly update ctxpkg: `npx -y ctxpkg@latest`

### Organization

- Use global collections for shared team knowledge: `ctxpkg col add -g team-docs ...`
- Use project collections for specific documentation
- Organize collections by purpose (api-docs, guides, policies, etc.)
