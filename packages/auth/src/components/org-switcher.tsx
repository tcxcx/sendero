'use client';

import { OrganizationSwitcher } from '@clerk/nextjs';

export function SenderoOrgSwitcher(props: {
  afterSelectOrganizationUrl?: string;
  afterCreateOrganizationUrl?: string;
}) {
  return (
    <OrganizationSwitcher
      afterSelectOrganizationUrl={props.afterSelectOrganizationUrl ?? '/app'}
      afterCreateOrganizationUrl={props.afterCreateOrganizationUrl ?? '/onboarding'}
      appearance={{
        elements: {
          organizationSwitcherTrigger: 'px-3 py-2',
        },
      }}
    />
  );
}
