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
