import { EmptyState } from '@komtru/ui-kit';

/**
 * A destination the shell can reach and its own ticket has not built yet.
 *
 * It says what belongs here in the words a person would use, because a scaffold a user can reach is
 * a screen whatever a plan calls it — no ticket numbers, no "coming soon", no spinner that will
 * never stop. Each of these is deleted by the ticket that owns the screen.
 */
export function Placeholder({ title, body }: { title: string; body: string }): React.JSX.Element {
  return <EmptyState title={title} body={body} />;
}
