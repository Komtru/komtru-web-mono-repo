// @vitest-environment jsdom
// F-045 (TF1, TF2): set up an authenticator app, then save the backup codes the platform shows once.
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwoFactorSetup } from '../src/account/TwoFactorSetup';
import { expectNoAxeViolations } from './axe';
import { problem } from './support/account';
import { SHELL_RULES, answerWith, callsTo, id, renderWithApi, type CallFn } from './support/trade';

const api = vi.hoisted(() => ({ call: vi.fn<CallFn>() }));
const assign = vi.fn();

beforeEach(() => {
  api.call.mockReset();
  assign.mockReset();
  Object.defineProperty(window, 'location', { value: { assign }, writable: true, configurable: true });
});
afterEach(cleanup);

const SEED = {
  factorId: id(500),
  secret: 'JBSWY3DPEHPK3PXP',
  otpauthUri: 'otpauth://totp/Komtru:amaka?secret=JBSWY3DPEHPK3PXP&issuer=Komtru',
};

const typeCode = (code: string) => {
  const cells = screen.getAllByRole('textbox');
  code
    .split('')
    .forEach((digit, index) => fireEvent.change(cells[index] as HTMLElement, { target: { value: digit } }));
};

describe('Two-factor setup (TF1, TF2)', () => {
  it('asks for the key once on opening, and shows it grouped, with the link a phone opens', async () => {
    answerWith(api.call, { 'POST /me/mfa/totp/enroll': SEED });
    const { container } = renderWithApi(api.call, <TwoFactorSetup />);
    expect(screen.getByRole('status', { name: 'Getting your setup key' })).toBeDefined();
    expect(await screen.findByText('JBSW Y3DP EHPK 3PXP')).toBeDefined();
    expect(screen.getByText('Can’t scan? Enter this code')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Open in your authenticator app' }).getAttribute('href')).toBe(
      SEED.otpauthUri,
    );
    expect(callsTo(api.call, 'POST', '/me/mfa/totp/enroll')).toHaveLength(1);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Verify & enable' }).disabled).toBe(true);
    await expectNoAxeViolations(container, SHELL_RULES);
  });

  it('activates with the factor and the six digits, then shows the backup codes once', async () => {
    answerWith(api.call, {
      'POST /me/mfa/totp/enroll': SEED,
      'POST /me/mfa/totp/activate': {
        factorId: SEED.factorId,
        recoveryCodes: ['7K2M-9PQX', '4RTS-VN31', '8WCF-2LKD'],
      },
    });
    const { container } = renderWithApi(api.call, <TwoFactorSetup />);
    await screen.findByText('JBSW Y3DP EHPK 3PXP');
    typeCode('248103');
    fireEvent.click(screen.getByRole('button', { name: 'Verify & enable' }));
    expect(await screen.findByText('Two-factor enabled')).toBeDefined();
    expect(callsTo(api.call, 'POST', '/me/mfa/totp/activate')[0]?.body).toEqual({
      factorId: SEED.factorId,
      code: '248103',
    });
    expect(screen.getByText('7K2M-9PQX')).toBeDefined();
    expect(screen.getByText('Shown once')).toBeDefined();
    // The seed is gone from the screen: it was for the step before.
    expect(screen.queryByText('JBSW Y3DP EHPK 3PXP')).toBeNull();
    await expectNoAxeViolations(container, SHELL_RULES);
    fireEvent.click(screen.getByRole('button', { name: 'I’ve saved these codes' }));
    expect(assign).toHaveBeenCalledWith('/account/security');
  });

  it('says a wrong code is wrong, clears it, and lets the person try again', async () => {
    answerWith(api.call, {
      'POST /me/mfa/totp/enroll': SEED,
      'POST /me/mfa/totp/activate': problem('OTP_INVALID', 401, { attemptsRemaining: 4 }),
    });
    renderWithApi(api.call, <TwoFactorSetup />);
    await screen.findByText('JBSW Y3DP EHPK 3PXP');
    typeCode('000000');
    fireEvent.click(screen.getByRole('button', { name: 'Verify & enable' }));
    expect(await screen.findByText('That code isn’t right. 4 tries left.')).toBeDefined();
    expect((screen.getAllByRole('textbox')[0] as HTMLInputElement).value).toBe('');
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeDefined();
  });

  it('adds a second method without a new sheet of codes, and says the old ones still work', async () => {
    answerWith(api.call, {
      'POST /me/mfa/totp/enroll': SEED,
      'POST /me/mfa/totp/activate': { factorId: SEED.factorId, recoveryCodes: null },
    });
    renderWithApi(api.call, <TwoFactorSetup />);
    await screen.findByText('JBSW Y3DP EHPK 3PXP');
    typeCode('248103');
    fireEvent.click(screen.getByRole('button', { name: 'Verify & enable' }));
    expect(await screen.findByText(/Your backup codes from before still work/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(assign).toHaveBeenCalledWith('/account/security');
  });

  it('offers a retry when the key could not be made', async () => {
    let calls = 0;
    answerWith(api.call, {
      'POST /me/mfa/totp/enroll': () => {
        calls += 1;
        return calls === 1 ? new Error('down') : SEED;
      },
    });
    renderWithApi(api.call, <TwoFactorSetup />);
    expect(await screen.findByText('We couldn’t start the setup')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeDefined());
  });
});
