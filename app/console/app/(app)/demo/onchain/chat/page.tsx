import { TreasuryChat } from './TreasuryChat'

export const metadata = { title: 'Demo — Portfolio Intelligence' }

export default async function Chat({ searchParams }: { searchParams: Promise<{ name?: string; wallet?: string }> }) {
  const { name, wallet } = await searchParams
  const w = wallet?.trim()
  return <TreasuryChat initialName={name?.trim() ?? ''} initialWallets={w && /^0x[0-9a-fA-F]{40}$/.test(w) ? [w] : []} />
}
