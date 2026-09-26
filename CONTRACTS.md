# CONTRACTS.md

Pinned deployment and constants for Recall on **Ethereum Sepolia** (chain ID `11155111`).

Every constant is marked **VERIFIED** or **ASSUMED** (rule 2). VERIFIED means checked
against the live chain or a vendored ABI on the date shown. If you find an ASSUMED
value is wrong, fix it here and say so.

- **Verified on:** 13 September 2026
- **Address source:** the official ENS documentation's Sepolia ENSv2 beta deployments
  table. These supersede the addresses in the contract repo's own deployment snapshots —
  see §1.
- **ABI source:** ENSv2 contracts monorepo `ensdomains/contracts-v2`, deployment set
  `contracts/deployments/sepolia`, at commit `48b3e2d39513b9dd32ef1850877a29009bc807b9`.
  ABIs are vendored into `engine/core/abis/` and are the **only** source of truth for
  what may be called (rule 1). Their compatibility with the documented addresses is
  verified selector-by-selector — see §2.
- **RPC used for verification:** `https://ethereum-sepolia-rpc.publicnode.com`

**Update, 15 September 2026 — the Universal Resolver pin moved.** The vanity proxy
`0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` began resolving through a registry set (root
`0x0F62FBF8A820B4F2590A6631D846467dA7384A55`, eth `0x1BD29E26f09b4c68c623141673e5F0a5d02709f6`) that
is not in the documentation's Sepolia table and does not contain names registered through the
documented ETHRegistrar. Following §1, the code now pins the documented `UniversalResolverV2`
(`0x4A1817d13E9cF196f471725176355C1234b63C70`), which resolves the documented root
`0x8115186E8f2E0B0281e86ab91f0f48Ba90364354` / eth `0xBDC85dD5b15D7ecb354cd7cb6f2c50b4f2c4F0E2`.
`knowledge init --register` additionally asserts `ETHRegistrar.ETH_REGISTRY == discovered eth registry`
before sending anything, because the failure mode is a paid-for name nobody can see.

Re-run the checks at any time:

```bash
pnpm check:abi          # rule 1 — no function or event named outside a vendored ABI
pnpm check:deployment   # rule 2 — every called selector exists in the deployed bytecode
pnpm resolve:check      # M0 — the foundation resolves a real name
```

---

## 1. The stale-address problem — read this before pinning anything

**The deployment snapshots committed to the ENSv2 contract repo do not match the live
chain.** At the pinned commit the repo carries two Sepolia sets (`sepolia` and
`sepolia-official-v1-20260525-r2`), and the live deployment matches *neither*. Both sets
are still live on chain and still receiving traffic, which is what makes this trap
convincing: the wrong addresses have code, answer calls, and have recent activity.

The authority is the **deployments table in the ENS documentation**, not the repo.

| Contract | Repo `sepolia` snapshot | Documented / live |
|---|---|---|
| RootRegistry | `0x11b5bfbe…f50c` | `0x8115186E8f2E0B0281e86ab91f0f48Ba90364354` |
| `.eth` registry | `0x67b728a7…4b43` | `0xBDC85dD5b15D7ecb354cd7cb6f2c50b4f2c4F0E2` |
| VerifiableFactory | `0x118bc31a…b70f` | `0x10dC6333CDFe1FCEf624c6e0a8221b91804Cd7ef` |
| UserRegistryImpl | `0x840fa461…61c0` | `0x624a25d67B59D587752EbEc8DdeD8827dAe52050` |
| PermissionedResolverImpl | `0x7e4b2d59…2303` | `0x9EAe5C2730a7dD16BDD1DeE6421a1B91e3B0365e` |
| MockUSDC | `0xd3322b29…3422f` | `0x768F42455A2D082E23ceeF7d51e5787C82d67a39` |

The two registries are **discovered at runtime** rather than pinned at all:

- root registry ← `UniversalResolver.ROOT_REGISTRY()`
- `.eth` registry ← `rootRegistry.getSubregistry("eth")`

See `getRootRegistry` / `getEthRegistry` in `engine/core/src/resolve.ts`. Both discovered
values match the documented table exactly, which is the check that the approach works.

---

## 2. Pinned addresses

### Universal Resolver — VERIFIED

| Constant | Value | Status |
|---|---|---|
| `UNIVERSAL_RESOLVER` | `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` | **VERIFIED** — 2491 bytes; resolves live names |

This is `UpgradableUniversalResolverProxy`, a fixed vanity address. **Always read through
this proxy**, never through an implementation address.

The docs list `UniversalResolverV2` at `0x4A1817d13E9cF196f471725176355C1234b63C70`. Both
that address and the proxy return the same `ROOT_REGISTRY`
(`0x8115186E…64354`), so they agree — but the proxy is the upgrade-stable entrypoint and is
what the code uses. The implementation has already moved at least once (it currently
delegates via `ManagedUniversalResolverProxy` at `0x6d80F217…e6F1`), which is precisely why
it is not pinned.

`UniversalResolverV2` is vendored **for its ABI only**. Do not call it directly.

### Contracts we deploy against — VERIFIED (documented, live, selector-checked)

| Constant | Address | Status |
|---|---|---|
| `addresses.verifiableFactory` | `0x10dC6333CDFe1FCEf624c6e0a8221b91804Cd7ef` | **VERIFIED** — 1411 bytes |
| `addresses.userRegistryImpl` | `0x624a25d67B59D587752EbEc8DdeD8827dAe52050` | **VERIFIED** — 17159 bytes |
| `addresses.permissionedResolverImpl` | `0x9EAe5C2730a7dD16BDD1DeE6421a1B91e3B0365e` | **VERIFIED** — 17597 bytes |

**How "the ABI matches" is established.** `pnpm check:deployment` takes every function this
codebase calls, computes its 4-byte selector from the vendored ABI, and checks that the
selector appears in the **deployed bytecode** at the pinned address. Absence is conclusive.
Currently: 23 registry functions, 20 resolver functions, 2 factory functions, 7 ERC-20
functions — all present. `supportsInterface(IPermissionedRegistry)` and
`supportsInterface(IPermissionedResolver)` also both return true.

Proxies are exempt from the selector scan and checked behaviourally instead — a proxy
delegates and holds no selectors of its own, so scanning one would report every function
missing.

### Stablecoin — VERIFIED

| Constant | Value | Status |
|---|---|---|
| `addresses.stablecoin` | `0x768F42455A2D082E23ceeF7d51e5787C82d67a39` | **VERIFIED** — `name()`/`symbol()` = `USDC` |
| `STABLECOIN_DECIMALS` | `6` | **VERIFIED** — `decimals()` returned `6` |

This is the ENSv2 deployment's own `MockUSDC`, which settles PRD open item 3. A different
token can be supplied to `SubscriptionRegistrar`'s constructor; if you do, re-verify
decimals, since a wrong value silently misprices every subscription.

---

## 3. Role constants — VERIFIED against vendored source

EAC packs 64 role slots into a `uint256` as **nybbles** (4 bits each): slots 0–31 are
regular roles, slots 32–63 are admin roles at exactly `regular << 128`. A nybble holds an
*assignee count* (0–15), not a boolean.

Transcribed in `engine/core/src/roles.ts` from `RegistryRolesLib.sol`,
`EACBaseRolesLib.sol` and `PermissionedResolverLib.sol` at the pinned commit.

| Constant | Value | Status |
|---|---|---|
| `ALL_ROLES` | `0x1111…1111` (bit 0 of every nybble) | **VERIFIED** |
| `ADMIN_ROLES` | `0x1111…0000` (upper 128 bits) | **VERIFIED** |
| `ROOT_RESOURCE` | `0` | **VERIFIED** — `ROOT_RESOURCE()` returns `0` on live contracts |

Registry roles (`RegistryRolesLib`): `REGISTRAR` `1<<0`, `REGISTER_RESERVED` `1<<4`,
`SET_PARENT` `1<<8`, `UNREGISTER` `1<<12`, `RENEW` `1<<16`, `SET_SUBREGISTRY` `1<<20`,
`SET_RESOLVER` `1<<24`, `WAS_RESERVED` `1<<32`, `SET_URI` `1<<36`, `CAN_NAME` `1<<120`,
`UPGRADE` `1<<124`. `CAN_TRANSFER` exists **only** as an admin role, `(1<<28)<<128`.

Resolver roles (`PermissionedResolverLib`): `SET_ADDR` `1<<0`, `SET_TEXT` `1<<4`,
`SET_CONTENTHASH` `1<<8`, `SET_PUBKEY` `1<<12`, `SET_ABI` `1<<16`, `SET_INTERFACE` `1<<20`,
`SET_NAME` `1<<24`, `SET_ALIAS` `1<<28`, `CLEAR` `1<<32`, `SET_DATA` `1<<36`,
`CAN_NAME` `1<<120`, `UPGRADE` `1<<124`.

---

## 4. Per-key record scoping — VERIFIED

The mechanism behind "a contributor can write only their own proposal key".

`PermissionedResolver` scopes permissions to a **(name, record-key)** pair, not to the name
alone. The resource is `keccak256(abi.encode(node, part))`, mirrored by `resolverResource`
in `roles.ts`:

- `partHash(string key)` = `keccak256(bytes(key))` — text and data keys
- `partHash(uint256 x)` = `keccak256(abi.encode(x))` — coin types, content types
- `resource(0, 0)` is the root resource and short-circuits without hashing

Grants are made through these **VERIFIED** helpers, present in the vendored ABI:

| Function | Effect |
|---|---|
| `authorizeDataRoles(bytes toName, string key, address account, bool grant)` | caller needs `SET_DATA_ADMIN` on `resource(node, 0)`; grants `SET_DATA` on `resource(node, partHash(key))` |
| `authorizeTextRoles(bytes toName, string key, address account, bool grant)` | same, for `SET_TEXT` |
| `authorizeAddrRoles(bytes toName, uint256 coinType, address account, bool grant)` | same, for `SET_ADDR` |
| `authorizeNameRoles(bytes toName, uint256 roleBitmap, address account, bool grant)` | grants an arbitrary bitmap on `resource(node, 0)` |

`toName` is **DNS-encoded**, not a string and not a namehash.

Grants emit `NamedDataResource` / `NamedTextResource` the first time a resource is used,
which is what the `/c/[collection]/audit` route reads.

---

## 5. Interface IDs — VERIFIED

From the `@dev Interface selector` tags, confirmed live via `supportsInterface`.

| Interface | ID |
|---|---|
| `IRegistry` | `0x51f67f40` |
| `IStandardRegistry` | `0xb844ab6c` |
| `ITokenizedRegistry` | `0x91b3c037` |
| `ITemporalRegistry` | `0x6f537c72` |
| `IPermissionedRegistry` | `0x6be50c69` |
| `IPermissionedResolver` | `0x91413117` |

---

## 6. Emancipation — the role set a collection subregistry must NOT keep

From the ENS Permissioned Registry documentation. A registry is **emancipated** when it is
a verified implementation and **no account holds a dangerous role on `ROOT_RESOURCE`**:

| Category | Roles |
|---|---|
| Direct threats | `ROLE_SET_RESOLVER`, `ROLE_SET_SUBREGISTRY`, `ROLE_UNREGISTER` |
| Escalation vectors | the admin variants of those, plus `ROLE_UPGRADE`, `ROLE_CAN_TRANSFER_ADMIN` |
| Explicitly safe | `ROLE_REGISTRAR`, `ROLE_RENEW` |

**Why this is load-bearing for Recall.** A collection's own subregistry holds every subscriber's
`sub-<addr>` name. A publisher holding root `ROLE_UNREGISTER` can delete a subscription
that has been paid for and has not expired; with root `ROLE_SET_RESOLVER` they can repoint
it. Either one makes "holding a live subname *is* the subscription" false.

So `deploy-collection.ts` initialises the collection subregistry with
`EMANCIPATED_REGISTRY_ROLES` — `ROLE_REGISTRAR_ADMIN | ROLE_RENEW_ADMIN`, whose admin
halves imply the regular halves — and nothing else. That is exactly enough to mint and
renew subscription names and to delegate both to `SubscriptionRegistrar`, and not enough to
interfere with a subscription already sold. After granting, the script reads
`roleCount(ROOT_RESOURCE)` and warns if any dangerous slot is occupied.

The publisher's *own* registry (the one holding the collection name under `publisher.eth`) is
deliberately **not** emancipated — it is their namespace and they must be able to manage it.

### The counting trap — VERIFIED by test

`roleCount(resource)` returns an **assignee count per nybble (0–15)**, not a flag. A role
held by two accounts is `2 << (4*slot)`, and `2 & 1 == 0` — so a naive
`counts & ROLE_UNREGISTER` reports the role as unheld *exactly when it is held twice*.

Counts are normalised with `rolesFromCounts`, a mirror of `EACBaseRolesLib.fromCounts`,
before any mask is applied. There is a test that asserts every count from 1 to 15 is
detected.

---

## 7. Token IDs are not stable — VERIFIED from source

Rule 5 restated with the mechanism. `IPermissionedRegistry` exposes three different ids for
one name, and its functions take `anyId` — "the labelhash, token ID, or resource":

- **labelhash** — `keccak256(label)`. Stable across every version. Key any cache or index
  on this.
- **tokenId** — regenerated when roles change or a name is re-registered. **Never cache.**
  Resolve with `findTokenId(label)` or `getTokenId(anyId)` immediately before use.
- **resource** — the EAC resource backing the name.

`getState(anyId)` returns all of them at once plus `status` and `expiry`.

Per the ENS docs, the token ID packs a `tokenVersionId` (which invalidates marketplace
approvals) and an `eacVersionId` (which isolates permissions) alongside the labelhash; role
changes burn the old token and mint a new one with incremented counters, emitting
**`TokenRegenerated(oldTokenId, newTokenId)`**. An indexer should key on the labelhash and
follow that event — the `/c/[collection]/audit` route surfaces it for exactly this reason.

### Other registry behaviour worth knowing

- Re-registering an **expired** name requires `ROLE_RENEW` (not just `ROLE_REGISTRAR`), and
  starts fresh — old owner and roles are discarded. Reviving via `renew()` instead
  *preserves* them. `deploy-collection.ts` grants the registrar both roles for this reason.
- `renew()` can never reduce an expiry.
- Transfers require `ROLE_CAN_TRANSFER_ADMIN` on the current owner. Subscription names are
  registered with a role bitmap of `0`, so a subscriber owns the token but cannot transfer
  it or repoint the name.
- **`setApprovalForAll(operator, true)` grants that operator every one of the owner's EAC
  roles on every name they hold.** It is far broader than an ERC-1155 approval normally
  implies. Nothing in Recall calls it.

---

## 8. Open items

| Item | Status |
|---|---|
| Stablecoin address (PRD §15.3) | **Resolved** — documented `MockUSDC` above, 6 decimals verified |
| Publisher ENS name on Sepolia (PRD §15.2) | **Open** — a `.eth` name must be registered and owned by the deploying wallet before M1 |
| Collection topic and seed entries (PRD §15.1) | **Open** — see `scripts/seed-entries.ts` |

---

## 9. Checked but deliberately not used

| Thing | Why not |
|---|---|
| `@ensdomains/ensjs` | ENSv1 only (rule 3). Not installed. |
| `@ensdomains/ens-contracts` (npm, 1.7.0) | ENSv1 registry/wrapper plus a v1-era UniversalResolver. Contains no `PermissionedRegistry`, no `EnhancedAccessControl`. Not a source for v2 ABIs. |
| `UniversalResolverV2` implementation address | Pinning it bypasses the upgrade proxy. ABI only. |
| Either deployment set committed to the contracts repo | Both are live and both are stale relative to the documented deployment. The ENS docs' deployments table is the authority; the repo snapshots are only a source of ABIs. |
| Hand-written `parseAbiItem` event signatures | `indexed` does not affect `topic0`, so a wrong signature still matches the log and then decodes to empty args — a silent failure. Events are read through the vendored ABI with `parseEventLogs`, and `pnpm check:abi` fails any hand-written signature for an event that exists in an ABI. |

---

## 11. Knowledge namespaces — VERIFIED live, 15 September 2026

The current product. Each namespace gets its own UserRegistry (children) and PermissionedResolver
(one `contenthash`), deployed via the Verifiable Factory. Owner role set on the registry:
REGISTRAR, RENEW, SET_SUBREGISTRY, SET_RESOLVER, UNREGISTER, SET_PARENT (+ admin halves); on the
resolver: SET_CONTENTHASH, SET_TEXT, CLEAR (+ admin halves).

| Item | Value |
|---|---|
| `worldhistory.eth` | registered via ETHRegistrar; registry `0x518f2143a7ac268cEedf12FF78972a494F3f9949`; resolver `0x23D250Be4CD38EBE1F9FD42A0371a7A083D5eA9F` |
| `india.worldhistory.eth` | registered under the parent registry; registry `0x8d179002c7cE732F963f3632a12096b2621fb861`; resolver `0x81Aa5C4bA3dEBd5614171f72a1f01CDd09B7d0de`; setParent `0x54204f96…` |
| publish txs | v1 `0xb8afdbf1…`, v2 `0xd5bea915…` (worldhistory); v1 `0xc82f156d…` (india) |

Public namespaces publish **plaintext** objects (`0xe30101551220 || sha256`, raw codec, CIDv1).
Functions used, all in vendored ABIs: `ETHRegistrar.isAvailable/getRegisterPrice/makeCommitment/commit/register/MIN_COMMITMENT_AGE/ETH_REGISTRY`,
`MockUSDC.mint/approve/allowance/balanceOf`, `VerifiableFactory.deployProxy`, `UserRegistry.initialize/register/setParent/getSubregistry`,
`ETHRegistry.getOwner/setSubregistry/setResolver`, `PermissionedResolver.initialize/setContenthash`, `UniversalResolverV2.findResolver/resolve/ROOT_REGISTRY`.

## 12. Namespace roles on chain — 26 September 2026

The policy's roles are now granted on each namespace's own PermissionedResolver
(`engine/core/src/publishers.ts`, `knowledge roles [--sync]`). Semantics checked against
`PermissionedResolver.sol` and `EnhancedAccessControl.sol` at the pinned commit:

| Role | Grant | Call | Why it is enough, and no more |
|---|---|---|---|
| owner | `ROLE_SET_CONTENTHASH` + admin on `ROOT_RESOURCE` (at `initialize`) | — | `hasRoles` is root ∪ resource, so the owner publishes and can grant |
| reviewer | `ROLE_SET_CONTENTHASH` on `resource(namehash(ns), 0)` | `authorizeNameRoles(dns(ns), SET_CONTENTHASH, account, grant)` | `setContenthash` is `onlyPartRoles(node, 0, …)`, which checks exactly this resource; no admin half, so it cannot be passed on |
| contributor (named) | `ROLE_SET_DATA` on `resource(node, partHash("knowledge.proposal.<name>"))` | `authorizeDataRoles(dns(ns), key, account, grant)` | `setData` checks the key's resource first; this one key and nothing else |

A member's account is the owner of their ENS name (`findOwner`), the same key that signs approvals.
Grants are idempotent (`_grantRoles` is a no-op when the bits are already set). Only
`hasRoles`, `authorizeNameRoles`, `authorizeDataRoles`, `setData` and `data` are added — all in the
vendored ABI and the deployed bytecode (`pnpm check:abi`, `pnpm check:deployment`).

**Resolver drift, rechecked 26 September 2026.** The vanity proxy
`0xeEeE…EeEe` now reports `ROOT_REGISTRY = 0x9703DBD26dAB89504490994138cF2c575251a9cE` (eth registry
`0x657eA849311d3D5823348ddEd7C2AaAFb3EDE09E`) — a third set, and not the one in the ENS docs preview
either (preview ETHRegistry `0xDEDB92913A25abE1f7BCDD85D8A344a43B398B67`). Through the vanity proxy,
`cancer-research.eth` and `treasury.eth` have no resolver; through the pinned `UniversalResolverV2` they
resolve. The pin stays until the documented deployment and the proxy agree.

## 10. Memory namespace — pre-pivot, 15 September 2026 (superseded)

The current product publishes one pointer per namespace. `memory.<identity>` is a subname
registered under the identity's own UserRegistry with a dedicated PermissionedResolver; the
wallet that owns the identity holds `SET_CONTENTHASH` (+ admin), `SET_TEXT` (+ admin) and
`CLEAR` (+ admin) on it. No subregistry: a namespace has no children.

| Item | Value |
|---|---|
| namespace | `memory.recalltest.eth` |
| identity registry | `0xb92e1E7AB519AEeea55bD904eDc58c7A4Fa92541` (UserRegistry proxy, from the earlier deployment) |
| namespace resolver | `0xC8600E692D25CAfD763dF4a2323fa44D5dcd4Cd4` (PermissionedResolver proxy via Verifiable Factory) |
| register tx | `0x6bb28e60d47c39e0c0f66ca84f7eeb32f8e9bb6269c58b31892771162625a493` |
| first push tx | `0xee8e14cb9d2818f723ab4111a9f719da495371f1a5b647c3ce56fbdc21eed01e` |

Functions used, all present in the vendored ABIs: `VerifiableFactory.deployProxy`,
`PermissionedResolver.initialize` / `setContenthash`, `UserRegistry.register`,
`ETHRegistry.getOwner` / `getSubregistry`, Universal Resolver `resolve(contenthash)`.

`contenthash` is the only mutable state. Refs and commit objects are AES-256-GCM encrypted
with the namespace key before pinning; the on-chain value is `0xe30101551220 || sha256`
(IPFS, raw codec, CIDv1) produced by `@ensdomains/content-hash` and round-trip checked.
