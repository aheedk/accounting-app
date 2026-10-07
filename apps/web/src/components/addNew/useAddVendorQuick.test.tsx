// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useAddVendorQuick, type QuickVendor } from './useAddVendorQuick';

const { apiPost } = vi.hoisted(() => ({ apiPost: vi.fn() }));

vi.mock('@/lib/business', () => ({
  useActiveBusinessId: () => ['44444444-4444-4444-8444-444444444444'],
}));

vi.mock('@/lib/apiClient', () => ({
  api: { post: apiPost },
}));

function Harness({ onPicked }: { onPicked: (vendor: QuickVendor) => void }) {
  const addVendor = useAddVendorQuick(() => {});
  return (
    <div>
      <button type="button" onClick={() => addVendor.open(onPicked)}>Open</button>
      {addVendor.dialog}
    </div>
  );
}

describe('useAddVendorQuick', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    apiPost.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function click(element: Element) {
    await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  }

  function setValue(field: HTMLInputElement, value: string) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function openDialog(onPicked: (vendor: QuickVendor) => void = () => {}) {
    await act(async () => {
      root.render(<Harness onPicked={onPicked} />);
    });
    await click(document.querySelector('button')!);
  }

  it('mirrors the company name into the display name until it is edited directly', async () => {
    await openDialog();
    const company = document.querySelector<HTMLInputElement>('#quick-vendor-company')!;
    const display = document.querySelector<HTMLInputElement>('#quick-vendor-display-name')!;

    await act(async () => setValue(company, 'Duke Energy'));
    expect(display.value).toBe('Duke Energy');

    await act(async () => setValue(company, 'Duke Energy Corp'));
    expect(display.value).toBe('Duke Energy Corp');

    // Once the user types their own display name, the mirror stops.
    await act(async () => setValue(display, 'Duke'));
    await act(async () => setValue(company, 'Something Else Entirely'));
    expect(display.value).toBe('Duke');
  });

  it('keeps Address collapsed until opened, and omits it from the request when left blank', async () => {
    apiPost.mockResolvedValue({ data: { id: 'v1', name: 'Acme' } });
    await openDialog();
    expect(document.querySelector('#quick-vendor-street')).toBeNull();

    await act(async () => setValue(document.querySelector<HTMLInputElement>('#quick-vendor-display-name')!, 'Acme'));
    const saveButton = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Save')!;
    await click(saveButton);

    expect(apiPost).toHaveBeenCalledWith('/businesses/44444444-4444-4444-8444-444444444444/vendors', {
      name: 'Acme',
      company_name: null,
      first_name: null,
      last_name: null,
      email: null,
      phone: null,
      billing_address: null,
    });
  });

  it('sends only the filled address fields, and picks/closes/toasts on success', async () => {
    apiPost.mockResolvedValue({ data: { id: 'v2', name: 'Bates Printing' } });
    let picked: QuickVendor | null = null;
    await openDialog(vendor => { picked = vendor; });

    await act(async () => setValue(document.querySelector<HTMLInputElement>('#quick-vendor-display-name')!, 'Bates Printing'));
    await click(Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Address')!);
    await act(async () => setValue(document.querySelector<HTMLInputElement>('#quick-vendor-city')!, 'Tampa'));
    await act(async () => setValue(document.querySelector<HTMLInputElement>('#quick-vendor-state')!, 'FL'));

    await click(Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Save')!);

    expect(apiPost).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      billing_address: { city: 'Tampa', state: 'FL' },
    }));
    expect(picked).toEqual({ id: 'v2', name: 'Bates Printing' });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).toContain('Vendor created');
  });

  it('shows the error inline and keeps the dialog open on failure', async () => {
    apiPost.mockRejectedValue({ response: { data: { error: { message: 'Vendor "Acme" already exists' } } } });
    await openDialog();
    await act(async () => setValue(document.querySelector<HTMLInputElement>('#quick-vendor-display-name')!, 'Acme'));

    await click(Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Save')!);

    expect(document.body.textContent).toContain('Vendor "Acme" already exists');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('requires a display name before Save is enabled', async () => {
    await openDialog();
    const saveButton = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Save') as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
  });
});
