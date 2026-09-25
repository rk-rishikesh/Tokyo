# @k01/cli

A terminal client for ENS-native versioned knowledge namespaces.

```bash
npm i -g @k01/cli
```

## A namespace of your own

```bash
knowledge init conventions.acme.eth --kind organisation
knowledge add "Use pnpm, not npm" --subject "Package manager" --topic conventions
knowledge status
knowledge push
```

`--register` registers the name on ENS as part of `init`. It checks that the
registrar and the registry agree before sending anything, because they have
disagreed in the wild and the failure is expensive.

## Contributing to someone else's

```bash
knowledge propose "Production deploys need a second approver" --export proposal.json
# send the file; no server in between
knowledge pull-proposal proposal.json
knowledge review 1 --approve --sign
knowledge land 1
```

## Importing what you already have

```bash
knowledge import memory export.json --vendor chatgpt --split --owner you.eth
knowledge import wikipedia "Ashoka" --namespace india.worldhistory.eth
```

The memory importer reads an assistant's export and turns each remembered fact
into a claim citing that export. It skips conversation transcripts by design —
what you said to an assistant at 2am is not a fact about the world.

## Policy

```bash
knowledge policy --reviewer expert.eth --approvals 1 --conflicts ask
knowledge policy --publish interval --interval-minutes 60
```

## Related

- [`@k01/repo`](../repo) — what these commands do underneath
- [`@k01/mcp`](../mcp) — the same operations for an agent

MIT
