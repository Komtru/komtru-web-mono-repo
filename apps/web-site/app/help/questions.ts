import { HOME_FAQ, type FaqEntry } from '../../src/site/faq';

/**
 * The Help page's question list, grouped by topic.
 *
 * It lives here rather than in `src/site/faq.ts` because only this page asks these: `faq.ts` is
 * shared with the band above the footer on every page, and a fourteen-question list would be
 * loaded by all of them to be used by one.
 *
 * Where a question is already answered in `HOME_FAQ`, the entry is pulled in rather than retyped.
 * The two lists overlap on purpose — see the comment at the top of `faq.ts` — and the overlap is
 * only safe while it is one answer in one place. Retyping it gives the site two answers to the
 * same question, and the day someone corrects one of them it will have two different ones.
 */

/**
 * The shared entry for `question`, or a build-time failure.
 *
 * Looked up by text rather than by index because the point is to notice when the shared list
 * changes: an index silently returns a different answer, this throws while `next build` is
 * running, before anyone reads the wrong one.
 */
const shared = (question: string): FaqEntry => {
  const entry = HOME_FAQ.find((item) => item.question === question);
  if (entry === undefined) {
    throw new Error(`The Help page reuses a HOME_FAQ question that no longer exists: “${question}”`);
  }
  return entry;
};

export interface HelpTopic {
  readonly heading: string;
  readonly questions: readonly FaqEntry[];
}

/**
 * The reference wrote this as one flat run of fourteen questions. Fourteen disclosure rows with
 * nothing between them is a wall to skim, so they are grouped under headings a reader can scan —
 * the questions and the answers are the reference's words, the grouping is ours.
 */
export const HELP_TOPICS: readonly HelpTopic[] = [
  {
    heading: 'The basics',
    questions: [
      {
        question: 'What is Komtru? Is it a marketplace?',
        answer:
          'No. Komtru isn’t a marketplace. You find items on Instagram, WhatsApp, TikTok or Facebook, then agree the trade on Komtru, where your payment is protected until the item you agreed is delivered.',
      },
      {
        question: 'Where does Komtru work?',
        answer:
          'We’re launching in Lagos, Abuja, Port Harcourt and Jos this December, and delivery is available across Nigeria.',
      },
      shared('What does it cost?'),
    ],
  },
  {
    heading: 'Paying and protection',
    questions: [
      shared('How does payment protection work?'),
      {
        question: 'What is a Trade Code, and why not a link?',
        answer:
          'A Trade Code, like KMT-482731, points to one trade. Fake payment links are common, so Komtru never asks you to pay from a link. Search the code on Komtru yourself and see the trade.',
      },
      shared('What if the seller never ships?'),
    ],
  },
  {
    heading: 'Delivery and inspection',
    questions: [
      {
        /*
         * `HOME_FAQ` asks this too, and its answer ends "and you can ask for more". This one names
         * the caps. It is kept separate rather than reused because they are not the same answer:
         * the home band is a summary for someone deciding whether to use Komtru at all, and the
         * numbers belong on the page someone opens mid-trade to find out how long they have.
         */
        question: 'How long do I have to check the item?',
        answer:
          '48 hours for Electronics and 24 hours for Fashion & Luxury. You can ask for up to 72 and 48 hours. For a motor park, the clock starts 12 hours after the parcel arrives.',
      },
      {
        question: 'How does a park pickup work?',
        answer:
          'The parcel arrives sealed and you’re told. Show your pickup PIN to the agent, check the seal and the item, then confirm or report a problem.',
      },
    ],
  },
  {
    heading: 'When something goes wrong',
    questions: [
      {
        question: 'What if the item isn’t as described?',
        answer:
          'Report it with photos. Your payment stays protected. You can try to settle with the seller, or a person decides using the evidence.',
      },
      {
        question: 'How do returns and refunds work?',
        answer:
          'The outcome can be a return and refund, a replacement, a partial settlement, or the payment going to the seller. Returns are handed in sealed and tracked until the seller checks them.',
      },
      {
        question: 'Can I appeal a decision?',
        answer: 'Yes, once. Someone who wasn’t part of the first decision takes a second look.',
      },
    ],
  },
  {
    heading: 'Selling and your account',
    questions: [
      {
        question: 'What do I need to list an item?',
        answer:
          'Get verified, then add at least three photos and a video taken on your own camera, accurate item details, and your delivery options.',
      },
      {
        question: 'What is a Trust Passport?',
        answer:
          'A shareable record of your completed trades, verification and how problems were handled. Facts, not a score.',
      },
      {
        question: 'I lost my phone. Can I recover my account?',
        answer: 'Contact us from another phone. We’ll check it’s really you before restoring access.',
      },
    ],
  },
];
