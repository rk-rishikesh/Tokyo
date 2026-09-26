# @knowledge01/mcp

Agent access to knowledge namespaces over the Model Context Protocol.

Gives an agent nineteen tools for reading and contributing to versioned
namespaces. Every one of them is about knowledge — search, propose, review,
land, diff, revert. There is nothing here that books, sends or replies, and that
is a property of the design rather than a feature not yet written.

```bash
npm i @knowledge01/mcp
```

## Running it

```jsonc
// claude_desktop_config.json, or any MCP client
{
  "mcpServers": {
    "knowledge": {
      "command": "npx",
      "args": ["-y", "@knowledge01/mcp"],
      "env": { "PINATA_GATEWAY": "<your-gateway>.mypinata.cloud" }
    }
  }
}
```

| Variable | |
|---|---|
| `PINATA_GATEWAY` | **required** — the dedicated gateway reads are fetched through |
| `KNOWLEDGE_AGENT` | optional — the name your contributions are signed with; a label, defaults to `reader` |
| `KNOWLEDGE_NAMESPACE` | optional — the namespace a call uses when it names none |
| `KNOWLEDGE_READER_KEY` | optional — the key a sealed namespace granted you (e.g. bought over x402); opens it in `knowledge_read`, never signs |
| `PRIVATE_KEY` | optional — only `knowledge_push` uses it |

## The tools

| | |
|---|---|
| `knowledge_search` `knowledge_get` | find and read claims, with their sources |
| `knowledge_status` `knowledge_history` `knowledge_diff` | what is here, and what changed |
| `knowledge_observe` `knowledge_propose` | contribute, subject to policy |
| `knowledge_review` `knowledge_land` | the review workflow |
| `knowledge_branch` `knowledge_merge` `knowledge_revert` | ordinary version control |
| `knowledge_resolve` | a namespace's policy, and who may publish or propose on ENS, read live |
| `knowledge_read` | read straight from ENS and IPFS; sealed namespaces open with your own grant |
| `knowledge_push` `knowledge_pull` | publish to ENS, read from it |

`knowledge_push` refuses unless a private key is present in that process. An
agent holding a funded wallet is a different product and a much worse idea, so
the server does not hold one by default.

## Related

- [`@knowledge01/repo`](../repo) — the operations these tools expose
- [`@knowledge01/cli`](../cli) — the same operations for a person

MIT
