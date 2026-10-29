import { useCallback, useEffect, useMemo, useState } from 'react'
import { BrowserProvider, Contract, ethers } from 'ethers'
import {
  addresses,
  formatAddress,
  formatApr,
  formatUsdc,
  mockUsdcContract,
  parseUsdc,
  savingCoreContract,
  usdcUnit,
} from './contracts'
import './styles.css'

type Plan = {
  id: bigint
  aprBps: bigint
  penaltyBps: bigint
  tenorDays: bigint
  minDeposit: bigint
  maxDeposit: bigint
}

type Deposit = {
  id: bigint
  planId: bigint
  principal: bigint
  aprBps: bigint
  openTimestamp: bigint
  maturityAt: bigint
  status: number
  interest: bigint
}

const statusNames = ['Active', 'Withdrawn', 'Manual renewed', 'Auto renewed']

function App() {
  const [provider, setProvider] = useState<BrowserProvider>()
  const [signer, setSigner] = useState<ethers.JsonRpcSigner>()
  const [account, setAccount] = useState('')
  const [plans, setPlans] = useState<Plan[]>([])
  const [deposits, setDeposits] = useState<Deposit[]>([])
  const [balance, setBalance] = useState(0n)
  const [selectedPlan, setSelectedPlan] = useState('1')
  const [amount, setAmount] = useState('550')
  const [renewPlan, setRenewPlan] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const readProvider = useMemo(() => provider, [provider])

  const refresh = useCallback(async () => {
    if (!readProvider || !account) return
    const core = savingCoreContract(readProvider)
    const token = mockUsdcContract(readProvider)
    const planIds = await core.getActivePlans()
    const loadedPlans = await Promise.all(
      planIds.map(async (id) => {
        const plan = await core.plans(id)
        return {
          id,
          aprBps: plan.aprBps,
          penaltyBps: plan.penaltyBps,
          tenorDays: plan.tenorDays,
          minDeposit: plan.minDeposit,
          maxDeposit: plan.maxDeposit,
        }
      }),
    )
    const depositIds = await core.getUserDeposits(account)
    const loadedDeposits = await Promise.all(
      depositIds.map(async (id) => {
        const deposit = await core.deposits(id)
        return {
          id,
          planId: deposit.planId,
          principal: deposit.principal,
          aprBps: deposit.aprBpsAtOpen,
          openTimestamp: deposit.openTimestamp,
          maturityAt: deposit.maturityAt,
          status: Number(deposit.status),
          interest: await core.calculateInterest(id),
        }
      }),
    )
    setPlans(loadedPlans)
    setDeposits(loadedDeposits)
    setBalance(await token.balanceOf(account))
    if (!loadedPlans.some((plan) => plan.id.toString() === selectedPlan) && loadedPlans[0]) {
      setSelectedPlan(loadedPlans[0].id.toString())
    }
  }, [account, readProvider, selectedPlan])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!window.ethereum) return
    const ethereum = window.ethereum
    const handleAccounts = (...values: unknown[]) => {
      const accounts = values[0] as string[]
      if (accounts.length === 0) {
        setAccount('')
        setSigner(undefined)
      } else {
        void connectWallet()
      }
    }
    ethereum.on?.('accountsChanged', handleAccounts)
    return () => ethereum.removeListener?.('accountsChanged', handleAccounts)
  }, [])

  async function connectWallet() {
    try {
      setError('')
      if (!window.ethereum) throw new Error('MetaMask is not installed.')
      const nextProvider = new BrowserProvider(window.ethereum)
      await nextProvider.send('eth_requestAccounts', [])
      const nextSigner = await nextProvider.getSigner()
      setProvider(nextProvider)
      setSigner(nextSigner)
      setAccount(await nextSigner.getAddress())
    } catch (reason) {
      setError(getErrorMessage(reason))
    }
  }

  async function runTransaction(label: string, action: () => Promise<ethers.TransactionResponse>) {
    if (!signer) return
    try {
      setBusy(label)
      setError('')
      setMessage(`Waiting for ${label} confirmation...`)
      const transaction = await action()
      await transaction.wait()
      setMessage(`${label} completed.`)
      await refresh()
    } catch (reason) {
      setError(getErrorMessage(reason))
      setMessage('')
    } finally {
      setBusy('')
    }
  }

  async function openDeposit() {
    if (!signer) return
    const value = parseUsdc(amount)
    const token = mockUsdcContract(signer)
    const currentAllowance = await token.allowance(account, addresses.savingCore)
    await runTransaction('opening deposit', async () => {
      if (currentAllowance < value) {
        const approval = await token.approve(addresses.savingCore, value)
        await approval.wait()
      }
      return savingCoreContract(signer).openDeposit(BigInt(selectedPlan), value)
    })
  }

  function isMatured(deposit: Deposit) {
    return BigInt(Math.floor(Date.now() / 1000)) >= deposit.maturityAt
  }

  function date(value: bigint) {
    return new Date(Number(value) * 1000).toLocaleString()
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">BLOCKCHAIN ONLINE BANKING</p>
          <h1>Term Deposit</h1>
        </div>
        <button className="wallet-button" onClick={() => void connectWallet()}>
          {account ? formatAddress(account) : 'Connect MetaMask'}
        </button>
      </header>

      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}

      {!account ? (
        <section className="welcome card">
          <span className="icon">◇</span>
          <h2>Manage your savings on-chain</h2>
          <p>Connect MetaMask to view plans, open a deposit, and manage your certificates.</p>
          <button className="primary" onClick={() => void connectWallet()}>Connect wallet</button>
          <small>Network: Hardhat Local (chain 31337)</small>
        </section>
      ) : (
        <>
          <section className="summary-grid">
            <div className="card summary"><span>Wallet</span><strong>{formatAddress(account)}</strong><small>Connected account</small></div>
            <div className="card summary"><span>USDC balance</span><strong>{formatUsdc(balance)}</strong><small>6 decimal MockUSDC</small></div>
            <div className="card summary"><span>Active certificates</span><strong>{deposits.filter((deposit) => deposit.status === 0).length}</strong><small>ERC721 deposits</small></div>
          </section>

          <section className="card">
            <div className="section-heading"><div><p className="eyebrow">PRODUCTS</p><h2>Available saving plans</h2></div><button className="ghost" onClick={() => void refresh()}>Refresh</button></div>
            <div className="plan-grid">
              {plans.map((plan) => (
                <article className={`plan ${selectedPlan === plan.id.toString() ? 'selected' : ''}`} key={plan.id.toString()} onClick={() => setSelectedPlan(plan.id.toString())}>
                  <div className="plan-top"><span>Plan #{plan.id.toString()}</span><b>{formatApr(plan.aprBps)} APR</b></div>
                  <h3>{plan.tenorDays.toString()} days</h3>
                  <p>Early penalty: {formatApr(plan.penaltyBps)}</p>
                  <p>{plan.minDeposit === 0n ? 'No minimum' : `Min ${formatUsdc(plan.minDeposit)} USDC`} · {plan.maxDeposit === 0n ? 'No maximum' : `Max ${formatUsdc(plan.maxDeposit)} USDC`}</p>
                </article>
              ))}
            </div>
            {plans.length === 0 && <p className="muted">No enabled plans found. Check contract addresses and deployment.</p>}
          </section>

          <section className="card open-card">
            <div className="section-heading"><div><p className="eyebrow">NEW DEPOSIT</p><h2>Open a deposit</h2></div></div>
            <div className="form-row">
              <label>Plan<select value={selectedPlan} onChange={(event) => setSelectedPlan(event.target.value)}>{plans.map((plan) => <option key={plan.id.toString()} value={plan.id.toString()}>Plan #{plan.id.toString()} · {plan.tenorDays.toString()} days · {formatApr(plan.aprBps)}</option>)}</select></label>
              <label>Amount (USDC)<input type="number" min="0" step="0.000001" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
              <button className="primary action-button" disabled={!signer || !selectedPlan || !amount || busy !== ''} onClick={() => void openDeposit()}>{busy === 'opening deposit' ? 'Confirming...' : 'Open deposit'}</button>
            </div>
            <small className="muted">The first transaction approves USDC if necessary, then opens the NFT certificate.</small>
          </section>

          <section className="card">
            <div className="section-heading"><div><p className="eyebrow">MY DEPOSITS</p><h2>Your certificates</h2></div></div>
            <div className="deposit-list">
              {deposits.map((deposit) => (
                <article className="deposit" key={deposit.id.toString()}>
                  <div className="deposit-main"><div className="certificate">#{deposit.id.toString()}</div><div><h3>Deposit #{deposit.id.toString()}</h3><span className={`status status-${deposit.status}`}>{statusNames[deposit.status]}</span><p>{formatUsdc(deposit.principal)} USDC · {formatApr(deposit.aprBps)} APR · Plan #{deposit.planId.toString()}</p></div></div>
                  <div className="deposit-details"><span><small>Maturity</small><b>{date(deposit.maturityAt)}</b></span><span><small>Interest now</small><b>{formatUsdc(deposit.interest)} USDC</b></span></div>
                  {deposit.status === 0 && <div className="deposit-actions">
                    <button className="secondary" disabled={!isMatured(deposit) || busy !== ''} onClick={() => void runTransaction('withdrawing deposit', () => savingCoreContract(signer!).withdrawAtMaturity(deposit.id))}>{isMatured(deposit) ? 'Withdraw at maturity' : 'Not matured'}</button>
                    <button className="danger" disabled={isMatured(deposit) || busy !== ''} onClick={() => void runTransaction('early withdrawal', () => savingCoreContract(signer!).earlyWithdraw(deposit.id))}>Early withdraw</button>
                    {isMatured(deposit) && <><select value={renewPlan[deposit.id.toString()] || plans[0]?.id.toString() || ''} onChange={(event) => setRenewPlan({ ...renewPlan, [deposit.id.toString()]: event.target.value })}>{plans.map((plan) => <option key={plan.id.toString()} value={plan.id.toString()}>Renew to Plan #{plan.id.toString()}</option>)}</select><button className="primary" disabled={busy !== ''} onClick={() => void runTransaction('renewing deposit', () => savingCoreContract(signer!).renewDeposit(deposit.id, BigInt(renewPlan[deposit.id.toString()] || plans[0].id.toString())))}>Renew</button></>}
                  </div>}
                </article>
              ))}
              {deposits.length === 0 && <p className="muted">No deposits found for this wallet.</p>}
            </div>
          </section>
        </>
      )}
      <footer>SavingCore · VaultManager · MockUSDC</footer>
    </main>
  )
}

function getErrorMessage(reason: unknown) {
  if (reason instanceof Error) return reason.message.replace(/^execution reverted: /, '')
  return 'Transaction failed. Check your wallet and contract configuration.'
}

export default App
