/**
 * Who the dashboard reads on Base mainnet.
 *
 * Watched wallets are Agent A's: large public wallets on Base it compares you
 * with. Named ones resolve from public ENS or Basenames; the largest holders
 * on Base carry no public label, so they are shown as unlabelled rather than
 * guessed at. The demo wallet is used until a visitor enters their own.
 */
export type Watched = { label: string; address: string }

export const WATCHED: Watched[] = [
  { label: 'jesse.base.eth', address: '0x2211d1D0020DAEA8039E46Cf1367962070d77DA9' },
  { label: 'vitalik.eth', address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
  { label: 'Unlabelled whale', address: '0xa7C0D36c4698981FAb42a7d8c783674c6Fe2592d' },
  { label: 'Unlabelled whale', address: '0x3304E22DDaa22bCdC5fCa2269b418046aE7b566A' },
  { label: 'Unlabelled whale', address: '0xaDFffc33cdC9970349CBcEa3D73Ec343d6ed116D' },
]

export const DEMO_WALLET: Watched = { label: 'base.base.eth', address: '0x97BCd93504d89D9d236E773e8f5C20fEaE466e72' }
