import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_FAILURES_PER_ADDRESS, addressRefusal, clearSignInFailures, recordFailedSignIn, resetLoginThrottle,
} from '../../src/lib/loginThrottle.js';

const T0 = 1_800_000_000_000;
const fail = (address: string, times: number, now = T0) => { for (let i = 0; i < times; i++) recordFailedSignIn(address, now); };

describe('sign-in limit per address', () => {
  beforeEach(() => resetLoginThrottle());

  it('refuses an address after too many wrong sign-ins, and says for how long', () => {
    fail('1.2.3.4', MAX_FAILURES_PER_ADDRESS - 1);
    expect(addressRefusal('1.2.3.4', T0)).toBeNull();
    fail('1.2.3.4', 1);
    expect(addressRefusal('1.2.3.4', T0 + 60_000)).toBe('Too many sign-in attempts from this network. Try again in 14 minutes.');
    expect(addressRefusal('5.6.7.8', T0)).toBeNull();
  });

  it('lets the address try again once the 15 minutes are up', () => {
    fail('1.2.3.4', MAX_FAILURES_PER_ADDRESS);
    expect(addressRefusal('1.2.3.4', T0 + 15 * 60_000)).toBeNull();
  });

  it('starts again from nothing after a successful sign-in', () => {
    fail('1.2.3.4', MAX_FAILURES_PER_ADDRESS - 1);
    clearSignInFailures('1.2.3.4');
    fail('1.2.3.4', 1);
    expect(addressRefusal('1.2.3.4', T0)).toBeNull();
  });
});
