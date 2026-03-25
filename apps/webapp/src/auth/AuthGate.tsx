type AuthGateProps = {
  authError: string | null
  onContinue: () => void
}

export function AuthGate({ authError, onContinue }: AuthGateProps) {
  return (
    <main className="auth-shell">
      <p className="auth-brand">Holodeck</p>
      <section className="auth-panel">
        <span className="auth-corner auth-corner-tl" aria-hidden="true" />
        <span className="auth-corner auth-corner-tr" aria-hidden="true" />
        <span className="auth-corner auth-corner-bl" aria-hidden="true" />
        <span className="auth-corner auth-corner-br" aria-hidden="true" />
        <p className="auth-kicker">SYS: READY</p>
        <h1 className="auth-title">Holodeck</h1>
        <p className="auth-copy">Your inbox, playable. Connect your account to enter the simulation.</p>
        {authError && (
          <p className="auth-error" role="alert">Sign-in failed. Try again.</p>
        )}
        <button className="auth-button" type="button" onClick={onContinue}>
          Initialize with Google
        </button>
      </section>
    </main>
  )
}
