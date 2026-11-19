import type { Metadata } from 'next';
import { SellCategory } from '../../../../../../src/sell/Category';

export const metadata: Metadata = { title: 'What you sell' };

/** SO2 (T-121): what the person sells, which sets the Trade Standards on every listing. */
export default function SellCategoryPage(): React.JSX.Element {
  return <SellCategory />;
}
