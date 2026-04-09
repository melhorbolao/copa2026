'use client'

import { Component, type ReactNode } from 'react'
import { AlertBanner } from './AlertBanner'

interface State { hasError: boolean }

class AlertErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  render() { return this.state.hasError ? null : this.props.children }
}

export function AlertBannerWrapper() {
  return (
    <AlertErrorBoundary>
      <AlertBanner />
    </AlertErrorBoundary>
  )
}
