'use client'

/**
 * Connect a wallet, choose a name, start.
 *
 * Three steps, and the middle one used to be "type a name you own", which asks
 * someone to recall a string the chain already knows. Now the wallet is asked
 * first and its names are looked up — pick from a list, or register one if
 * there is nothing to pick.
 *
 * The registration path sends transactions from the person's own wallet. A host
 * that registered names on someone's behalf would hold the keys to them, which
 * would make the resulting namespace exactly as borrowed as the subdomain this
 * replaced.
 */
import { useState } from 'react'

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> }
const injected = (): Eth | null =>
  typeof window !== 'undefined' ? ((window as unknown as { ethereum?: Eth }).ethereum ?? null) : null

type OwnedName = { name: string; expiresAt?: string }
type Step = 'wallet' | 'name' | 'registering'

const SEPOLIA = '0xaa36a7' // 11155111

/**
 * The names live on one chain, so everything here has to happen on it.
 *
 * This was only checked before registering, which meant someone on Base Sepolia
 * — a different chain with the same word in its name — could connect, be told
 * they own nothing, and sign a message that proved nothing. The lookup silently
 * asks the wrong registry and the wallet happily signs, so nothing fails loudly
 * enough to notice.
 *
 * `wallet_switchEthereumChain` throws 4902 when the wallet has never heard of
 * the chain, which is the case for a fresh MetaMask. Adding it is the same
 * request with the details filled in.
 */
async function requireSepolia(eth: Eth): Promise<void> {
  const current = (await eth.request({ method: 'eth_chainId' })) as string
  if (current?.toLowerCase() === SEPOLIA) return
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA }] })
  } catch (e) {
    const code = (e as { code?: number })?.code
    if (code !== 4902) throw new Error('This runs on Ethereum Sepolia. Switch networks in your wallet and try again.')
    await eth.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: SEPOLIA,
        chainName: 'Sepolia',
        nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
        blockExplorerUrls: ['https://sepolia.etherscan.io'],
      }],
    })
  }
  // A wallet can refuse without throwing, so confirm rather than assume.
  const after = (await eth.request({ method: 'eth_chainId' })) as string
  if (after?.toLowerCase() !== SEPOLIA) {
    throw new Error('Still on another network. These names live on Ethereum Sepolia.')
  }
}

/** Minimal ABI encoding for the four calls, so no wallet library is needed. */
const SELECTOR = {
  mint: '0x40c10f19', // mint(address,uint256)
  approve: '0x095ea7b3', // approve(address,uint256)
  commit: '0xf14fcbc8', // commit(bytes32)
} as const

const pad = (hex: string): string => hex.replace(/^0x/, '').padStart(64, '0')
const num = (v: string): string => pad(BigInt(v).toString(16))
const addr = (a: string): string => pad(a.toLowerCase().replace(/^0x/, ''))

export type SignedIn = { name: string; address: string | null }

export function Onboarding({ signedIn }: { signedIn?: SignedIn } = {}) {
  const [step, setStep] = useState<Step>('wallet')
  const [address, setAddress] = useState<string | null>(null)
  const [names, setNames] = useState<OwnedName[]>([])
  const [chosen, setChosen] = useState('')
  const [wanted, setWanted] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string[]>([])
  const [checked, setChecked] = useState<{ name: string; status: string } | null>(null)

  const say = (s: string) => setProgress((p) => [...p, s])

  async function connectWallet() {
    setError(null)
    const eth = injected()
    if (!eth) { setError('No wallet found in this browser. MetaMask or Rabby will do.'); return }
    setBusy('Waiting for your wallet…')
    try {
      const [a] = (await eth.request({ method: 'eth_requestAccounts' })) as string[]
      if (!a) throw new Error('no account')

      // Before any lookup: on the wrong chain the registry read returns
      // nothing, and "you own no names" is a lie rather than an answer.
      setBusy('Checking the network…')
      await requireSepolia(eth)
      setAddress(a)

      setBusy('Looking up names you own…')
      const res = await fetch('/api/names/owned', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: a }),
      })
      const { names: found = [] } = (await res.json()) as { names?: OwnedName[] }
      setNames(found)
      setChosen(found[0]?.name ?? '')
      setStep('name')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not connect')
    } finally {
      setBusy(null)
    }
  }

  /**
   * Ask the registry about a name the person typed.
   *
   * Necessary because the list cannot be exhaustive: with no reverse index, a
   * name registered anywhere but here is invisible until someone names it.
   */
  async function checkName() {
    if (!address) return
    const name = `${wanted.trim().toLowerCase().replace(/\.eth$/, '')}.eth`
    setError(null)
    setChecked(null)
    setBusy('Asking the registry…')
    try {
      const res = await fetch('/api/names/status', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, name }),
      })
      const out = (await res.json()) as { status?: string; error?: string }
      if (!out.status) throw new Error(out.error ?? 'could not check that name')
      setChecked({ name, status: out.status })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not check that name')
    } finally {
      setBusy(null)
    }
  }

  /** Prove a name this wallet already owns, and sign in. */
  async function useName(name: string) {
    const eth = injected()
    if (!eth || !address) return
    setError(null)
    setBusy('Preparing…')
    try {
      // The wallet may have moved since the lookup.
      await requireSepolia(eth)
      const ch = await fetch('/api/wallet/challenge', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, name }),
      })
      const { message, error: chErr } = (await ch.json()) as { message?: string; error?: string }
      if (!message) throw new Error(chErr ?? 'could not start')

      setBusy('Sign in your wallet — this costs nothing')
      const signature = (await eth.request({ method: 'personal_sign', params: [message, address] })) as string

      setBusy('Checking the registry…')
      const res = await fetch('/api/wallet/verify', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, name, signature, message }),
      })
      const out = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(out.error ?? 'could not verify')
      window.location.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'something went wrong')
    } finally {
      setBusy(null)
    }
  }

  /**
   * Register a new name.
   *
   * Four transactions and a wait: mint the test stablecoin, approve the
   * registrar, commit, wait out the front-running protection, register. Every
   * one is sent by the person's wallet.
   */
  async function register() {
    const eth = injected()
    if (!eth || !address) return
    setError(null)
    setProgress([])
    setStep('registering')
    try {
      setBusy('Pricing the name…')
      const res = await fetch('/api/names/register', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, name: wanted }),
      })
      const p = (await res.json()) as Record<string, string> & { waitSeconds: number; error?: string }
      if (p.error) throw new Error(p.error)

      // A name registered on the wrong chain is not a name.
      setBusy('Checking the network…')
      await requireSepolia(eth)

      const send = async (to: string, data: string, label: string) => {
        setBusy(label)
        const hash = (await eth.request({
          method: 'eth_sendTransaction',
          params: [{ from: address, to, data }],
        })) as string
        say(`${label} — ${hash.slice(0, 10)}…`)
        return hash
      }

      await send(p.stablecoin!, `${SELECTOR.mint}${addr(address)}${num(p.mintAmount!)}`, 'Minting test USDC')
      await send(p.stablecoin!, `${SELECTOR.approve}${addr(p.registrar!)}${num(p.mintAmount!)}`, 'Approving the registrar')
      await send(p.registrar!, `${SELECTOR.commit}${pad(p.commitment!)}`, 'Committing to the name')

      // The wait is the front-running protection. It cannot be skipped, so it
      // is shown counting down rather than hidden behind a spinner.
      for (let left = p.waitSeconds + 5; left > 0; left--) {
        setBusy(`Waiting out the commitment — ${left}s. This stops anyone front-running your name.`)
        await new Promise((r) => setTimeout(r, 1000))
      }

      setBusy('Registering — approve in your wallet')
      const registerRes = await fetch('/api/names/register-data', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, label: p.label, secret: p.secret, duration: p.duration }),
      })
      const { data, error: dErr } = (await registerRes.json()) as { data?: string; error?: string }
      if (!data) throw new Error(dErr ?? 'could not build the registration')
      await send(p.registrar!, data, 'Registering the name')

      // A wallet returns a hash when it broadcasts, not when it is mined. The
      // next step asks the registry who owns the name, and asking too early
      // reports that a registration which actually succeeded belongs to
      // nobody.
      setBusy('Waiting for the registration to land…')
      const landed = await fetch('/api/names/wait', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, name: p.name }),
      })
      if (!landed.ok) {
        const { error: wErr } = (await landed.json()) as { error?: string }
        throw new Error(wErr ?? 'the registration has not landed yet')
      }
      say(`${p.name} is yours`)
      await useName(p.name!)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'registration failed')
      setStep('name')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <Steps current={step} />

      {step === 'wallet' && signedIn ? (
        <Panel
          title="You're signed in"
          body="Your memory is written under this name. Continue where you left off, or sign in with another wallet."
        >
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-raised/50 px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-added" aria-hidden />
            <div className="min-w-0">
              <p className="font-mono text-[15px] font-semibold">{signedIn.name}</p>
              {signedIn.address ? <p className="font-mono text-[12.5px] text-dim">{signedIn.address.slice(0, 6)}…{signedIn.address.slice(-4)} · Sepolia</p> : <p className="text-[12.5px] text-dim">this machine&rsquo;s owner</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <a href="/app" className="rounded-xl bg-ink px-5 py-3 text-[15px] font-medium text-bg transition-opacity hover:opacity-90">Continue to your agent →</a>
            {signedIn.address ? (
              <button onClick={() => void connectWallet()} disabled={!!busy} className="rounded-xl border border-line px-4 py-3 text-[14px] text-dim transition-colors hover:text-ink disabled:opacity-50">
                {busy ?? 'Use a different wallet'}
              </button>
            ) : null}
          </div>
        </Panel>
      ) : null}

      {step === 'wallet' && !signedIn ? (
        <Panel
          title="Connect your wallet"
          body="Your wallet decides where your memory lives. Nothing is spent to sign in."
        >
          <button
            onClick={() => void connectWallet()}
            disabled={!!busy}
            className="rounded-xl bg-ink px-5 py-3 text-[15px] font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ?? 'Connect wallet'}
          </button>
        </Panel>
      ) : null}

      {step === 'name' ? (
        <Panel
          title={names.length ? 'Choose the name to use' : 'Register a name'}
          body={
            names.length
              ? 'Everything the agent learns is written under the name you pick. You can change it later; what was written stays where it was.'
              : 'This wallet does not own a name we could find. Register one and it is yours — the transactions come from your wallet, not from us.'
          }
        >
          {address ? (
            <p className="mb-3 font-mono text-[13px] text-dim">{address.slice(0, 6)}…{address.slice(-4)}</p>
          ) : null}

          {names.length ? (
            <div className="space-y-2">
              {names.map((n) => (
                <label
                  key={n.name}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
                    chosen === n.name ? 'border-accent/50 bg-accent-soft' : 'border-line hover:border-accent/30'
                  }`}
                >
                  <input
                    type="radio"
                    name="ens"
                    checked={chosen === n.name}
                    onChange={() => setChosen(n.name)}
                    className="accent-[hsl(var(--accent))]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[14px]">{n.name}</span>
                    {n.expiresAt ? (
                      <span className="block text-[12.5px] text-dim">renews {n.expiresAt.slice(0, 10)}</span>
                    ) : null}
                  </span>
                </label>
              ))}
              <button
                onClick={() => void useName(chosen)}
                disabled={!chosen || !!busy}
                className="mt-1 w-full rounded-xl bg-ink px-5 py-3 text-[15px] font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ?? `Continue with ${chosen || 'a name'}`}
              </button>
            </div>
          ) : null}

          <div className={names.length ? 'mt-5 border-t border-line pt-4' : ''}>
            {names.length ? (
              <p className="mb-2 text-[14px] text-dim">Or register a new one:</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <input
                value={wanted}
                onChange={(e) => setWanted(e.target.value.replace(/\.eth$/, ''))}
                placeholder="yourname"
                spellCheck={false}
                autoCapitalize="none"
                className="min-w-0 flex-1 rounded-xl border border-line bg-bg px-4 py-3 font-mono text-[14px] outline-none focus:border-accent/50"
              />
              <span className="self-center font-mono text-[14px] text-dim">.eth</span>
              <button
                onClick={() => void checkName()}
                disabled={wanted.trim().length < 3 || !!busy}
                className="rounded-xl border border-line px-5 py-3 text-[15px] font-medium transition-colors hover:border-accent/50 disabled:opacity-50"
              >
                Check
              </button>
            </div>
            {checked ? (
              <div className="mt-3 rounded-xl border border-line bg-raised/40 px-4 py-3">
                {checked.status === 'owned' ? (
                  <>
                    <p className="text-[14.5px]">You own <span className="font-mono">{checked.name}</span>.</p>
                    <button
                      onClick={() => void useName(checked.name)}
                      disabled={!!busy}
                      className="mt-2 rounded-lg bg-ink px-4 py-2 text-[14.5px] font-medium text-bg disabled:opacity-50"
                    >
                      {busy ?? `Continue with ${checked.name}`}
                    </button>
                  </>
                ) : checked.status === 'available' ? (
                  <>
                    <p className="text-[14.5px]"><span className="font-mono">{checked.name}</span> is free.</p>
                    <button
                      onClick={() => void register()}
                      disabled={!!busy}
                      className="mt-2 rounded-lg bg-ink px-4 py-2 text-[14.5px] font-medium text-bg disabled:opacity-50"
                    >
                      Register it
                    </button>
                  </>
                ) : (
                  <p className="text-[14.5px] text-dim">
                    <span className="font-mono">{checked.name}</span> belongs to someone else.
                  </p>
                )}
              </div>
            ) : null}
            <p className="mt-2 text-[13px] leading-relaxed text-dim">
              Registering runs on Sepolia and is paid in a test stablecoin your wallet mints for free — five
              transactions, about ninety seconds. We cannot list every name you own: ENSv2 has no reverse index yet,
              so a name we have not seen before has to be checked by asking.
            </p>
          </div>
        </Panel>
      ) : null}

      {step === 'registering' ? (
        <Panel title={`Registering ${wanted}.eth`} body="Every transaction comes from your wallet. Leave this open.">
          {busy ? <p className="text-[13.5px]">{busy}</p> : null}
          {progress.length ? (
            <ul className="mt-3 space-y-1">
              {progress.map((p, i) => (
                <li key={i} className="font-mono text-[13px] text-dim">✓ {p}</li>
              ))}
            </ul>
          ) : null}
        </Panel>
      ) : null}

      {error ? <p className="text-[14px] text-removed">{error}</p> : null}
    </div>
  )
}

function Panel({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-line bg-surface p-6 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_24px_-12px_rgba(0,0,0,0.08)]">
      <h2 className="font-display text-[22px] leading-tight">{title}</h2>
      <p className="mt-1.5 max-w-lg text-[13.5px] leading-relaxed text-dim">{body}</p>
      <div className="mt-5">{children}</div>
    </div>
  )
}

const STEPS: { id: Step; label: string }[] = [
  { id: 'wallet', label: 'Wallet' },
  { id: 'name', label: 'Name' },
  { id: 'registering', label: 'Sources' },
]

function Steps({ current }: { current: Step }) {
  const at = STEPS.findIndex((s) => s.id === current)
  return (
    <ol className="flex items-center gap-2 text-[13px]">
      {STEPS.map((s, i) => (
        <li key={s.id} className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full border text-[12.5px] ${
              i <= at ? 'border-accent/50 bg-accent-soft text-ink' : 'border-line text-dim'
            }`}
          >
            {i + 1}
          </span>
          <span className={i <= at ? 'text-ink' : 'text-dim'}>{s.label}</span>
          {i < STEPS.length - 1 ? <span className="mx-1 h-px w-6 bg-line" /> : null}
        </li>
      ))}
    </ol>
  )
}
