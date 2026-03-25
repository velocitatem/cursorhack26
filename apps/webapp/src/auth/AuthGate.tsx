type AuthGateProps = {
  authError: string | null
  onContinue: () => void
}

export function AuthGate({ authError, onContinue }: AuthGateProps) {
  return (
    <main className="auth-shell">
      <p className="auth-brand">Inbox Quest</p>
      <section className="auth-panel">
        <h1 className="auth-title">Play through today&apos;s mail.</h1>
        <p className="auth-copy">Walk the block world, talk to threads as NPCs, then send what you meant to send.</p>
        <p className="auth-tagline">One short run. Real drafts at the end.</p>
        <div className="auth-pitch">
          <p>
            Today&apos;s inbox becomes a short story run: talk to characters, pick branches, then review and send the
            drafts you chose.
          </p>
          <ul className="auth-flow">
            <li>Emails become characters, scenes, and choices.</li>
            <li>Your playthrough becomes ready-to-send drafts.</li>
            <li>You review, approve, and send in seconds.</li>
          </ul>
        </div>
        {authError && (
          <p className="auth-error" role="alert">Sign-in failed. Try again.</p>
        )}
        <button className="auth-button" type="button" onClick={onContinue}>
          Try demo with Google
        </button>
        <p className="auth-secondary-cta">See how it works in under 30 seconds.</p>
      </section>
    </main>
  )
}
