import { buildRepositoryWorkspaceSlug } from '../src/lib/agent-sandbox.js';
import { afterEach, describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ENV_NAMES = [
  'AGENT_SANDBOX_ALLOWED_OUTBOUND_HOSTS',
  'AGENT_SANDBOX_ENABLED',
  'AGENT_SANDBOX_GITHUB_PAT',
  'AGENT_SANDBOX_GITHUB_REPO_BRANCH',
  'AGENT_SANDBOX_GITHUB_REPO_URL',
  'AGENT_SANDBOX_NETWORK_MODE',
  'PROVIDER_MODEL_NAME',
  'WHATSAPP_PHONE_NUMBER_ID',
] as const;
const ORIGINAL_ENV = new Map(ENV_NAMES.map(name => [name, process.env[name]]));

function restoreEnv() {
  for (const [name, value] of ORIGINAL_ENV.entries()) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

function setEnv(values: Partial<Record<(typeof ENV_NAMES)[number], string | undefined>>) {
  restoreEnv();
  process.env.WHATSAPP_PHONE_NUMBER_ID = 'pn_test';
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

async function workflowSource() {
  const url = pathToFileURL(
    resolve(rootDir, 'workflows/sendero-whatsapp-support-agent/workflow.ts')
  );
  url.searchParams.set('test', `${Date.now()}-${Math.random()}`);
  const module = await import(url.href);
  const workflow = module.buildWorkflow();
  return workflow.toSourceFiles();
}

interface WorkflowSource {
  definition: {
    nodes: Array<{
      id: string;
      data: { config: Record<string, unknown> };
    }>;
  };
  metadata: {
    triggers: Array<Record<string, unknown>>;
  };
}

function agentNodeConfig(source: WorkflowSource): Record<string, unknown> {
  return source.definition.nodes.find(node => node.id === 'support_agent')?.data.config ?? {};
}

afterEach(() => restoreEnv());

describe('sendero whatsapp support workflow', () => {
  it('builds stable sandbox repository mount paths', () => {
    expect(buildRepositoryWorkspaceSlug('tcxcx', 'sendero', 'main')).toBe('tcxcx-sendero');
    expect(buildRepositoryWorkspaceSlug('tcxcx', 'sendero', 'feature/support-handoff')).toBe(
      'tcxcx-sendero@feature--support-handoff'
    );
  });

  it('uses provider model names, function slugs, and trigger phone number ids', async () => {
    setEnv({
      AGENT_SANDBOX_ENABLED: 'false',
      AGENT_SANDBOX_GITHUB_PAT: '',
      AGENT_SANDBOX_GITHUB_REPO_URL: '',
      PROVIDER_MODEL_NAME: 'provider-model-test',
    });
    const source = await workflowSource();
    const config = agentNodeConfig(source);

    expect(config.provider_model_name).toBe('provider-model-test');
    expect(
      config.flow_agent_function_tools.some(
        tool => tool.function_slug === 'sendero-whatsapp-support-ask-team-question'
      )
    ).toBe(true);
    expect(config.flow_agent_function_tools.some(tool => tool.name === 'get_tenant_context')).toBe(
      true
    );
    expect(
      config.flow_agent_function_tools.some(tool => tool.name === 'get_whatsapp_setup_status')
    ).toBe(true);
    expect(
      config.flow_agent_function_tools.some(tool => tool.name === 'send_whatsapp_flow_message')
    ).toBe(true);
    expect(config.sandbox_enabled).toBe(false);
    expect(source.metadata.triggers[0]).toMatchObject({
      phoneNumberId: 'pn_test',
      triggerType: 'inbound_message',
    });
  });

  it('injects sandbox config for the Sendero GitHub repository', async () => {
    setEnv({
      AGENT_SANDBOX_GITHUB_REPO_URL: 'https://github.com/tcxcx/sendero',
      AGENT_SANDBOX_ALLOWED_OUTBOUND_HOSTS: 'docs.kapso.ai,\nAPI.SENDERO.TRAVEL, docs.kapso.ai',
    });

    const source = await workflowSource();
    const config = agentNodeConfig(source);
    const resource = config.flow_agent_resources?.[0];

    expect(config.sandbox_enabled).toBe(true);
    expect(config.sandbox_network_mode).toBe('allow_list');
    expect(config.sandbox_allowed_outbound_hosts).toEqual(['docs.kapso.ai', 'api.sendero.travel']);
    expect(resource).toEqual({
      resource_type: 'github_repository',
      repo_url: 'https://github.com/tcxcx/sendero',
      branch: 'main',
    });
    expect(config.system_prompt).toContain('/workspace/repos/tcxcx-sendero');
  });

  it('can explicitly disable sandbox without a repository url', async () => {
    setEnv({ AGENT_SANDBOX_ENABLED: 'false' });
    const source = await workflowSource();
    const config = agentNodeConfig(source);

    expect(config.sandbox_enabled).toBe(false);
    expect(config.flow_agent_resources).toBeUndefined();
  });
});
