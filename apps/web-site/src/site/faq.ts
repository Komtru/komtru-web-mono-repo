/**
 * The eight questions in the band above the footer, as the reference wrote them.
 *
 * These are the site-wide ones, asked before someone has decided anything. The Help page carries a
 * longer list for people who have already started — the two overlap on purpose, because someone
 * who lands on Help from a search should not have to go to the home page for the basics.
 */

export interface FaqEntry {
  readonly question: string;
  readonly answer: string;
}

export const HOME_FAQ: readonly FaqEntry[] = [
  {
    question: 'What is Komtru?',
    answer:
      'Komtru is trust infrastructure for social commerce. You find an item on Instagram, WhatsApp, TikTok or Facebook, agree the trade on Komtru, and your payment is protected until the item you agreed is delivered. Both sides build a record people can see and trust.',
  },
  {
    question: 'Who is Komtru built for?',
    answer:
      'Buyers who don’t want to send money to a stranger, sellers who want to be paid for the Trades they honour, and motor-park hubs that hand over parcels safely.',
  },
  {
    question: 'How does payment protection work?',
    answer:
      'You pay inside Komtru. The money is protected, not paid out. It’s released to the seller only when you confirm the item, or an agreed outcome is reached. It never leaves on its own.',
  },
  {
    question: 'What if the seller never ships?',
    answer:
      'Your payment stays protected until the item you agreed is delivered. If the seller doesn’t ship, the Trade doesn’t complete and the agreement decides what happens next.',
  },
  {
    question: 'Do I pay from a link a seller sends me?',
    answer:
      'No. Komtru never asks you to pay from a link. Search the Trade Code on Komtru yourself and pay there.',
  },
  {
    question: 'How long do I have to check the item?',
    answer:
      '48 hours for Electronics and 24 hours for Fashion & Luxury, and you can ask for more. For a motor park, the clock starts 12 hours after the parcel arrives.',
  },
  {
    question: 'What does it cost?',
    answer:
      'You see every fee before you pay. The 1.5% Buyer Protection Fee on the Pricing page is an example until fees are confirmed.',
  },
  {
    question: 'Is my money secure?',
    answer:
      'Your payment is protected until the item you agreed is delivered, and released only when you confirm or an agreed outcome is reached. No system can promise fraud will never happen, but agreements, evidence and human review reduce the risk.',
  },
];
