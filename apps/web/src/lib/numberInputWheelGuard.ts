/**
 * Stop the scroll wheel from silently editing amounts.
 *
 * Browsers increment a focused `<input type="number">` when the wheel scrolls
 * over it. In an accounting app that turns a mis-scroll into a wrong journal
 * amount with no visible cause and nothing in the audit trail to explain it.
 *
 * The field is blurred rather than the event cancelled: calling preventDefault
 * would also stop the page scrolling, so the page would feel stuck. Blurring
 * leaves the value untouched and lets the scroll through.
 *
 * Installed once at startup so it covers every number input in the app,
 * including ones that render a raw <input> instead of the shared component.
 */
export function installNumberInputWheelGuard(root: Document = document): () => void {
  function onWheel(event: Event) {
    const element = event.target;
    if (!(element instanceof HTMLInputElement)) return;
    if (element.type !== 'number') return;
    // An unfocused number input is not affected by the wheel, so leave it be.
    if (element !== root.activeElement) return;
    element.blur();
  }

  // Passive: we never cancel the event, only drop focus.
  root.addEventListener('wheel', onWheel, { passive: true });
  return () => root.removeEventListener('wheel', onWheel);
}
