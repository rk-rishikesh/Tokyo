import { TreasuryChat } from './TreasuryChat'

export const metadata = { title: 'Demo — treasury agent' }

export default async function Chat({ searchParams }: { searchParams: Promise<{ name?: string }> }) {
  const { name } = await searchParams
  return <TreasuryChat initialName={name?.trim() ?? ''} />
}
