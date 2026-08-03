import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Component, Suspense, type ReactNode } from 'react';
import { lazyWithReload } from '../lazyWithReload';

/** Minimal error boundary so a genuinely-rethrown failure (test 3 below) has somewhere to land
 *  instead of crashing the test render itself — mirrors how the real app always has
 *  <ErrorBoundary> around its routes. */
class TestErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    return this.state.hasError ? <div>Something went wrong</div> : this.props.children;
  }
}

/**
 * Tests for the stale-hashed-chunk self-recovery wrapper — see lazyWithReload.ts's doc comment
 * for the full incident (2026-08-03): after a Cloudflare Pages redeploy replaces hashed JS
 * chunk filenames, a browser tab that's been open since before the deploy can request an
 * old (now-404ing) chunk on navigation, and this app's SPA-fallback `_routes.json` serves
 * index.html (text/html) for that 404 — producing "Failed to load module script ... MIME type
 * of text/html", reported as "the entire site is broken".
 */
describe('lazyWithReload', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders the component normally when the dynamic import succeeds (no reload)', async () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', { value: { reload: reloadSpy }, writable: true });

    const TestComponent = lazyWithReload(async () => ({
      default: () => <div>Loaded fine</div>,
    }));

    render(
      <Suspense fallback={<div>Loading…</div>}>
        <TestComponent />
      </Suspense>
    );

    await waitFor(() => expect(screen.getByText('Loaded fine')).toBeInTheDocument());
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('triggers exactly one window.location.reload() when the dynamic import fails (simulating a stale/404 chunk)', async () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', { value: { reload: reloadSpy }, writable: true });

    const TestComponent = lazyWithReload(async () => {
      throw new Error('Failed to fetch dynamically imported module');
    });

    render(
      <Suspense fallback={<div>Loading…</div>}>
        <TestComponent />
      </Suspense>
    );

    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem('lazyWithReload:reloaded')).toBe('1');
  });

  it('does not reload a second time in the same session if sessionStorage already recorded a reload attempt', async () => {
    sessionStorage.setItem('lazyWithReload:reloaded', '1');
    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', { value: { reload: reloadSpy }, writable: true });
    // Suppress React's expected "error boundary caught an error" console.error noise for this
    // intentionally-failing case.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const TestComponent = lazyWithReload(async () => {
      throw new Error('Failed to fetch dynamically imported module');
    });

    render(
      <TestErrorBoundary>
        <Suspense fallback={<div>Loading…</div>}>
          <TestComponent />
        </Suspense>
      </TestErrorBoundary>
    );

    // The failure should be rethrown (caught by the error boundary) rather than triggering
    // another reload.
    await waitFor(() => expect(screen.getByText('Something went wrong')).toBeInTheDocument());
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});
