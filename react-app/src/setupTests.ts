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
