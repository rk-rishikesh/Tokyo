/**
 * Who the dashboard reads on Base mainnet.
 *
 * The watched wallets are Agent A's: public treasuries it compares you with.
 * The demo wallet is an ordinary public Base wallet used when a visitor has
 * not entered their own (`?wallet=`).
 */
export type Watched = { label: string; address: string }

export const WATCHED: Watched[] = [
  { label: 'vitalik.eth', address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
]

export const DEMO_WALLET: Watched = { label: 'Demo wallet', address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' }
