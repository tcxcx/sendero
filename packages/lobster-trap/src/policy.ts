export const SENDERO_LOBSTER_TRAP_POLICY_NAME = 'sendero-enterprise-agent-trust';

export const SENDERO_LOBSTER_TRAP_POLICY_PATH =
  'packages/lobster-trap/policies/sendero_enterprise_policy.yaml';

export const SENDERO_LOBSTER_TRAP_CONFIG_PATH =
  'configs/lobstertrap/sendero_enterprise_policy.yaml';

export const SENDERO_POLICY_BLOCKED_RISKS = [
  'prompt_injection',
  'data_exfiltration',
  'credential_exposure',
  'credential_access_intent',
  'sensitive_filesystem_access',
  'dangerous_commands',
  'egress_pii_leakage',
  'egress_credential_leakage',
] as const;
