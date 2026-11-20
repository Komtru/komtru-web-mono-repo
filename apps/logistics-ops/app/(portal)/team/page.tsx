'use client';

import { PortalFrame } from '../../../src/shell/PortalFrame';
import { TeamScreen } from '../../../src/team/TeamScreen';

export default function TeamPage(): React.JSX.Element {
  return (
    <PortalFrame current="team" title="Team" description="Who can sign in to the portal for your company">
      {({ me, isAdmin }) => <TeamScreen me={me} isAdmin={isAdmin} />}
    </PortalFrame>
  );
}
