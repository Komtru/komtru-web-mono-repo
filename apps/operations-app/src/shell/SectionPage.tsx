import { EmptyState } from '@komtru/ui-kit';
import { ConsoleFrame } from './ConsoleFrame';
import { sectionById, type SectionId } from './nav';

/**
 * A section the shell can reach and its own ticket has not built yet. It says what belongs here in
 * the words a person would use, because a scaffold someone can reach is a screen whatever a plan
 * calls it: no ticket numbers, no "coming soon", no spinner that will never stop. The ticket that
 * owns the section replaces the body and keeps the frame.
 */
export function SectionPage({ id }: { id: SectionId }): React.JSX.Element {
  const section = sectionById(id);
  return (
    <ConsoleFrame current={id} title={section.label} description={section.summary}>
      <EmptyState title="Nothing to show here yet" body={section.summary} />
    </ConsoleFrame>
  );
}
