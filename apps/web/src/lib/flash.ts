/**
 * A short confirmation at the bottom of the screen ("Link copied") for actions
 * that otherwise leave no trace on the page. One at a time; gone after a moment.
 */
export function flashMessage(text: string, ms = 2500, root: Document = document): void {
  root.getElementById('flash-message')?.remove();
  const el = root.createElement('div');
  el.id = 'flash-message';
  el.setAttribute('role', 'status');
  el.textContent = text;
  el.className = 'fixed bottom-6 left-1/2 z-[100] -translate-x-1/2 rounded-md bg-gray-900 px-4 py-2 text-sm text-white shadow-lg';
  root.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
