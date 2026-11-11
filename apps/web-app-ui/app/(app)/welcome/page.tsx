import { redirect } from 'next/navigation';

/** The walkthrough's front door: a new sign-up lands here and starts at OB1. */
export default function WelcomePage(): never {
  redirect('/welcome/1');
}
