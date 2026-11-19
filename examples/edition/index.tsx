/* eslint-disable react-refresh/only-export-components */
// An edition module exports its `edition` beside the components it is made of.
import { CreditCard, LifeBuoy } from 'lucide-react';
import type { Edition } from '@/shared/edition/types';

// An example edition: what a distribution builds the console with in place of
// `src/edition`, by pointing RUNTARA_EDITION_DIR at its own directory.
//
//   RUNTARA_EDITION_DIR=examples/edition npm run build
//
// It fills in every part of `Edition`, and CI builds, type-checks and tests
// the console with it (`npm run test:edition`), so a change here that breaks an
// edition is seen in this repository, not first by a distribution.
//
// Like every edition it sits outside `src`, with no node_modules of its own:
// `react` and `lucide-react` below are this frontend's.

function Billing() {
  return <h1>Billing</h1>;
}

function AcceptInvitation() {
  return <h1>Accept the invitation</h1>;
}

function Help({ className }: { className?: string }) {
  return (
    <a
      className={className}
      href="https://example.com/help"
      aria-label="Help"
      target="_blank"
      rel="noreferrer"
    >
      <LifeBuoy size={16} />
    </a>
  );
}

export const edition: Edition = {
  routes: [{ path: '/billing', element: <Billing /> }],
  open: [{ path: '/invitations/:token', element: <AcceptInvitation /> }],
  menu: [
    {
      key: 'billing',
      title: 'Billing',
      to: '/billing',
      icon: <CreditCard size={16} />,
      allowedGroups: [],
    },
  ],
  settings: [{ key: 'members', title: 'Members', to: '/settings/members' }],
  footer: [Help],
  useTenants: () => [{ id: 'acme', role: 'owner' }],
  noWorkspace: <p>Create a workspace to get started.</p>,
};
