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
        <h1 className="auth-title">Your inbox is now a game.</h1>
        <p className="auth-copy">Email, but finally not miserable.</p>
        <p className="auth-tagline">Less dread. More flow. Same work, better experience.</p>
        <div className="auth-pitch">
          <p>
            Holodeck turns today&apos;s inbox into a story-driven run. Talk to characters, make decisions, and clear your
            queue without the usual drag.
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
