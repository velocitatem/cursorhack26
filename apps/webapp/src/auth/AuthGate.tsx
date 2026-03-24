type AuthGateProps = {
  authError: string | null
  onContinue: () => void
}

export function AuthGate({ authError, onContinue }: AuthGateProps) {
  return (
    <main className="auth-shell">
      <p className="auth-kicker">Inbox Quest</p>
      <h1 className="auth-title">Your inbox, playable.</h1>
      {authError && (
        <p className="auth-error" role="alert">Sign-in failed. Try again.</p>
      )}
      <button className="auth-button" type="button" onClick={onContinue}>
        Continue with Google
      </button>
    </main>
  )
}
