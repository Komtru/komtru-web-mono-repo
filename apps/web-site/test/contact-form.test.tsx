// @vitest-environment jsdom
// The contact form posts nothing — it opens the visitor's mail client. What is worth testing is
// the part that can silently go wrong: the link it builds, and that an incomplete form says so
// out loud rather than handing an empty mail draft to support.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ContactForm, mailtoHref } from '../src/contact/ContactForm';
import { CONTACT } from '../src/site/nav';

afterEach(cleanup);

const field = (label: string): HTMLElement => screen.getByLabelText(label);
const type = (label: string, value: string): boolean => fireEvent.change(field(label), { target: { value } });
const send = (): boolean => fireEvent.click(screen.getByRole('button', { name: 'Send' }));

describe('mailtoHref', () => {
  it('addresses the support inbox from CONTACT, never a literal', () => {
    const href = mailtoHref({ topic: 'A Trade', name: 'Ada', phone: '08030000000', message: 'Hi' });
    expect(href.startsWith(`mailto:${CONTACT.supportEmail}?`)).toBe(true);
  });

  it('puts the topic and the name in the subject, and the contact details in the body', () => {
    const url = new URL(
      mailtoHref({
        topic: 'My account',
        name: '  Ada Obi  ',
        phone: ' 0803 000 0000 ',
        message: '  My code never arrived.  ',
      }),
    );
    const query = new URLSearchParams(url.search);
    expect(query.get('subject')).toBe('My account — Ada Obi');
    expect(query.get('body')).toBe('My code never arrived.\n\nName: Ada Obi\nPhone: 0803 000 0000');
  });
});

describe('ContactForm', () => {
  it('refuses an empty form and says which three things it needs', () => {
    render(<ContactForm />);
    send();

    const error = screen.getByRole('alert');
    expect(error.textContent).toBe('Please add your name, phone number and a message.');
  });

  it('points the invalid fields at the message so a screen reader reads it with them', () => {
    render(<ContactForm />);
    send();

    const error = screen.getByRole('alert');
    for (const label of ['Your name', 'Phone number', 'Message']) {
      expect(field(label).getAttribute('aria-invalid')).toBe('true');
      expect(field(label).getAttribute('aria-describedby')).toBe(error.id);
    }
  });

  it('focuses the first thing that is missing, not the first field', () => {
    render(<ContactForm />);
    type('Your name', 'Ada');
    type('Phone number', '08030000000');
    send();

    expect(document.activeElement).toBe(field('Message'));
    expect(field('Your name').getAttribute('aria-invalid')).toBe('false');
  });

  it('offers the four topics the reference offers', () => {
    render(<ContactForm />);
    const options = Array.from(field('What’s it about?').querySelectorAll('option'));
    expect(options.map((option) => option.textContent)).toEqual([
      'A Trade',
      'My account',
      'Running a hub or partnership',
      'Something else',
    ]);
  });
});
