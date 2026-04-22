import { normalizeLocale } from '@sendero/locale';

type AuthCopy = {
  signIn: {
    title: string;
    description: string;
    asideTitle: string;
    asideItems: string[];
  };
  signUp: {
    title: string;
    description: string;
    asideTitle: string;
    asideItems: string[];
  };
  waitlist: {
    title: string;
    description: string;
    asideTitle: string;
    asideItems: string[];
  };
};

const AUTH_COPY: Record<string, AuthCopy> = {
  'en-US': {
    signIn: {
      title: 'Welcome back.',
      description:
        'Sign in with Clerk to return to your Sendero workspace for traveler sessions, policies, channel adapters, metering, billing, and settlement.',
      asideTitle: 'Agent workspace',
      asideItems: [
        'Protected routes stay behind Clerk session and organization checks.',
        'Organizations map to agencies, companies, operators, and agent clients.',
        'Traveler sessions, policies, channels, and action ledgers stay inside the app.',
      ],
    },
    signUp: {
      title: 'Request agent access.',
      description:
        'Join the Sendero testnet waitlist. Access opens with Clerk identity, then organization setup, channel adapters, policy configuration, metering, and Arc settlement.',
      asideTitle: 'Private testnet',
      asideItems: [
        'No wallet or passkey setup before Clerk grants access.',
        'Channels, policies, sessions, and billing are configured after the organization exists.',
        'Mainnet access stays gated while production webhooks and settlement mature.',
      ],
    },
    waitlist: {
      title: 'Join the Sendero agent network.',
      description:
        'Request private testnet access for persistent travel agents across WhatsApp, web, Slack, Teams, and MCP. We open tenant setup, channel adapters, policies, and Arc settlement from inside the protected app.',
      asideTitle: 'Private testnet',
      asideItems: [
        'One access flow: Clerk identity first, tenant setup and channels second.',
        'Duffel search, policy checks, metering, billing, and settlement stay behind protected routes.',
        'Mainnet launch notifications go to approved operators, agencies, companies, and agent clients.',
      ],
    },
  },
  'es-AR': {
    signIn: {
      title: 'Volvé a entrar.',
      description:
        'Ingresá con Clerk para volver a tu workspace de Sendero: sesiones de viaje, políticas, canales, medición, facturación y settlement.',
      asideTitle: 'Workspace del agente',
      asideItems: [
        'Las rutas protegidas quedan detrás de la sesión de Clerk y los controles de organización.',
        'Las organizaciones representan agencias, empresas, operadores y clientes agente.',
        'Sesiones, políticas, canales y ledger de acciones viven dentro de la app.',
      ],
    },
    signUp: {
      title: 'Pedí acceso al agente.',
      description:
        'Sumate a la waitlist de testnet. El acceso empieza con identidad Clerk y sigue con organización, canales, políticas, medición y settlement en Arc.',
      asideTitle: 'Testnet privada',
      asideItems: [
        'No hay wallet ni passkey antes de que Clerk habilite el acceso.',
        'Canales, políticas, sesiones y billing se configuran después de crear la organización.',
        'El acceso a mainnet queda cerrado hasta madurar webhooks y settlement productivos.',
      ],
    },
    waitlist: {
      title: 'Sumate a la red de agentes Sendero.',
      description:
        'Pedí acceso a la testnet privada para agentes de viaje persistentes en WhatsApp, web, Slack, Teams y MCP.',
      asideTitle: 'Testnet privada',
      asideItems: [
        'Un flujo de acceso: identidad Clerk primero, tenant y canales después.',
        'Duffel, políticas, medición, billing y settlement quedan detrás de rutas protegidas.',
        'El aviso de mainnet va a operadores, agencias, empresas y clientes agente aprobados.',
      ],
    },
  },
  'es-MX': {
    signIn: {
      title: 'Bienvenido de vuelta.',
      description:
        'Inicia sesión con Clerk para volver a tu workspace de Sendero: viajeros, políticas, canales, medición, facturación y liquidación.',
      asideTitle: 'Workspace del agente',
      asideItems: [
        'Las rutas protegidas pasan por sesión Clerk y controles de organización.',
        'Las organizaciones representan agencias, empresas, operadores y clientes agente.',
        'Sesiones, políticas, canales y ledger de acciones se quedan dentro de la app.',
      ],
    },
    signUp: {
      title: 'Solicita acceso al agente.',
      description:
        'Únete a la waitlist de testnet. El acceso empieza con Clerk y sigue con organización, canales, políticas, medición y liquidación en Arc.',
      asideTitle: 'Testnet privada',
      asideItems: [
        'No hay wallet ni passkey antes de que Clerk habilite el acceso.',
        'Canales, políticas, sesiones y billing se configuran después de crear la organización.',
        'Mainnet queda cerrado mientras maduran webhooks y liquidación productiva.',
      ],
    },
    waitlist: {
      title: 'Únete a la red de agentes Sendero.',
      description:
        'Solicita acceso privado para agentes de viaje persistentes en WhatsApp, web, Slack, Teams y MCP.',
      asideTitle: 'Testnet privada',
      asideItems: [
        'Un solo acceso: identidad Clerk primero, tenant y canales después.',
        'Duffel, políticas, medición, billing y settlement quedan detrás de rutas protegidas.',
        'El aviso de mainnet llega a operadores, agencias, empresas y clientes agente aprobados.',
      ],
    },
  },
  'pt-BR': {
    signIn: {
      title: 'Bem-vindo de volta.',
      description:
        'Entre com Clerk para voltar ao workspace Sendero: viajantes, políticas, canais, medição, billing e liquidação.',
      asideTitle: 'Workspace do agente',
      asideItems: [
        'Rotas protegidas ficam atrás da sessão Clerk e dos controles de organização.',
        'Organizações representam agências, empresas, operadores e clientes agente.',
        'Sessões, políticas, canais e ledger de ações ficam dentro do app.',
      ],
    },
    signUp: {
      title: 'Solicite acesso ao agente.',
      description:
        'Entre na waitlist da testnet. O acesso começa com Clerk e segue para organização, canais, políticas, medição e liquidação na Arc.',
      asideTitle: 'Testnet privada',
      asideItems: [
        'Sem wallet nem passkey antes do acesso via Clerk.',
        'Canais, políticas, sessões e billing são configurados depois da organização.',
        'Mainnet fica fechada enquanto webhooks e liquidação de produção amadurecem.',
      ],
    },
    waitlist: {
      title: 'Entre na rede de agentes Sendero.',
      description:
        'Solicite acesso privado para agentes de viagem persistentes em WhatsApp, web, Slack, Teams e MCP.',
      asideTitle: 'Testnet privada',
      asideItems: [
        'Um fluxo de acesso: identidade Clerk primeiro, tenant e canais depois.',
        'Duffel, políticas, medição, billing e settlement ficam atrás de rotas protegidas.',
        'Avisos de mainnet vão para operadores, agências, empresas e clientes agente aprovados.',
      ],
    },
  },
};

export function getAuthCopy(locale: string | null | undefined): AuthCopy {
  const normalized = normalizeLocale(locale) ?? 'en-US';
  return AUTH_COPY[normalized] ?? AUTH_COPY['en-US'];
}
