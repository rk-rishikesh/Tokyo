# @k01/mcp

Agent access to knowledge namespaces over the Model Context Protocol.

Gives an agent eighteen tools for reading and contributing to versioned
namespaces. Every one of them is about knowledge — search, propose, review,
land, diff, revert. There is nothing here that books, sends or replies, and that
is a property of the design rather than a feature not yet written.

```bash
npm i @k01/mcp
```

## Running it

```jsonc
// claude_desktop_config.json, or any MCP client
{
  "mcpServers": {
    "knowledge": {
      "command": "npx",
      "args": ["-y", "@k01/mcp"],
      "env": { "RECALL_CACHE_DIR": "~/.recall" }
    }
  }
}
```

## The tools

| | |
|---|---|
| `knowledge_search` `knowledge_get` | find and read claims, with their sources |
| `knowledge_status` `knowledge_history` `knowledge_diff` | what is here, and what changed |
| `knowledge_observe` `knowledge_propose` | contribute, subject to policy |
| `knowledge_review` `knowledge_land` | the review workflow |
| `knowledge_branch` `knowledge_merge` `knowledge_revert` | ordinary version control |
| `knowledge_push` `knowledge_pull` | publish to ENS, read from it |

`knowledge_push` refuses unless a private key is present in that process. An
agent holding a funded wallet is a different product and a much worse idea, so
the server does not hold one by default.

## Related

- [`@k01/repo`](../repo) — the operations these tools expose
- [`@k01/cli`](../cli) — the same operations for a person

MIT
