# Claude Code adapter

Two files make any Claude Code session a consumer and contributor of your team's namespace:

1. `.mcp.json` at the repository root (attaches the knowledge MCP server):

```json
{ "mcpServers": { "knowledge": {
    "command": "npx", "args": ["-y", "@knowledge01/mcp"],
    "env": { "KNOWLEDGE_NAMESPACE": "conventions.recalltest.eth", "KNOWLEDGE_AGENT": "<your-name>.eth" } } } }
```

2. `.claude/skills/knowledge/SKILL.md` (this folder's `SKILL.md`): search before answering
   "how do we…" questions; propose after the user states or corrects a convention.

Replace `conventions.recalltest.eth` with your namespace. This repository dogfoods both files.
