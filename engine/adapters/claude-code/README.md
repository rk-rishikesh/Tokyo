# Claude Code adapter

Two files make any Claude Code session a consumer and contributor of your team's namespace:

1. `.mcp.json` at the repository root (attaches the knowledge MCP server):

```json
{ "mcpServers": { "knowledge": {
    "command": "npx", "args": ["-y", "@knowledge01/mcp"],
    "env": { "PINATA_GATEWAY": "<gateway>.mypinata.cloud", "KNOWLEDGE_NAMESPACE": "conventions.acme.eth", "KNOWLEDGE_AGENT": "<your-name>.eth" } } } }
```

2. `.claude/skills/knowledge/SKILL.md` (this folder's `SKILL.md`): search before answering
   "how do we…" questions; propose after the user states or corrects a convention.

`conventions.acme.eth` is a live example team namespace (see it at https://explorer.ens.dev/conventions.acme.eth); replace it with your own `conventions.<org>.eth`. This repository dogfoods both files against it.
