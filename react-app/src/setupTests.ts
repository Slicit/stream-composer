import '@testing-library/jest-dom/vitest'

// React 19 checks this flag before deciding whether act() warnings/batching
// apply; without it, state updates from mock fetch resolutions outside an
// explicit act() call print a spurious warning even though the test itself
// is correct.
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// jsdom implements neither of these, which Radix's Select (shadcn's Select
// component) calls when opening/positioning its listbox — without stubs,
// every test that opens a Select throws "not a function" before it ever
// gets to assert anything.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {}
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// jsdom has neither ResizeObserver nor real layout (every element reports
// 0×0), so recharts' <ResponsiveContainer> (BandwidthChart) would sit
// permanently at zero size and never render its children — a stub that
// reports a plausible size the moment something starts observing is the
// standard workaround.
if (!globalThis.ResizeObserver) {
  class ResizeObserverStub {
    private callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
    }
    observe(target: Element) {
      this.callback([{ target, contentRect: { width: 600, height: 240 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}
