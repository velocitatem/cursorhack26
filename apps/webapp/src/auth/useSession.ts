import { useCallback, useEffect, useState } from 'react'

export type SessionResponse = {
  authenticated: boolean
  user: {
    id: string
    email: string
    name: string | null
    avatarUrl: string | null
  } | null
  gmailScopesGranted: boolean
}

const absoluteUrlPattern = /^https?:\/\//i

const resolveApiBaseUrl = () => {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim()
  if (configured) {
    if (absoluteUrlPattern.test(configured)) {
      return '/api'
    }
    return configured.replace(/\/+$/, '')
  }
  return '/api'
}

const API_BASE_URL = resolveApiBaseUrl()

const EMPTY_SESSION: SessionResponse = {
  authenticated: false,
  user: null,
  gmailScopesGranted: false,
}

function readAuthError(): string | null {
  return new URLSearchParams(window.location.search).get('auth_error')
}

function clearAuthErrorFromUrl() {
  const url = new URL(window.location.href)
  url.searchParams.delete('auth_error')
  window.history.replaceState({}, '', url)
}

export function useSession() {
  const [session, setSession] = useState<SessionResponse>(EMPTY_SESSION)
  const [isLoading, setIsLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(() => readAuthError())

  const refreshSession = useCallback(async () => {
    setIsLoading(true)

    try {
      const currentUrl = new URL(window.location.href)
      const exchangeToken = currentUrl.searchParams.get('exchange_token')
      if (exchangeToken) {
        const exchangeResponse = await fetch(`${API_BASE_URL}/auth/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: exchangeToken }),
        })

        if (!exchangeResponse.ok) {
          throw new Error(`Session exchange failed with status ${exchangeResponse.status}`)
        }

        const exchangePayload = (await exchangeResponse.json()) as SessionResponse
        currentUrl.searchParams.delete('exchange_token')
        window.history.replaceState({}, '', currentUrl)
        setSession(exchangePayload)
        if (exchangePayload.authenticated) {
          if (readAuthError() !== null) {
            clearAuthErrorFromUrl()
          }
          setAuthError((prev) => (prev !== null ? null : prev))
        }
        return
      }

      const response = await fetch(`${API_BASE_URL}/auth/session`, {
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error(`Session check failed with status ${response.status}`)
      }

      const payload = (await response.json()) as SessionResponse
      setSession(payload)

      if (payload.authenticated) {
        if (readAuthError() !== null) {
          clearAuthErrorFromUrl()
        }
        setAuthError((prev) => (prev !== null ? null : prev))
      }
    } catch (error) {
      console.error(error)
      setSession(EMPTY_SESSION)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshSession()
  }, [refreshSession])

  const beginGoogleLogin = useCallback(() => {
    const loginUrl = new URL(`${API_BASE_URL}/auth/google/login`, window.location.origin)
    loginUrl.searchParams.set('return_to', window.location.href)
    window.location.href = loginUrl.toString()
  }, [])

  const logout = useCallback(async () => {
    await fetch(`${API_BASE_URL}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    })

    setSession(EMPTY_SESSION)
  }, [])

  return {
    session,
    isLoading,
    authError,
    beginGoogleLogin,
    logout,
    refreshSession,
  }
}
