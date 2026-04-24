import { normalizeLocale } from '@sendero/locale';

export type AuthCopy = {
  /** Shown after Clerk redirects from “unrecognized device” session revoke (Dashboard → Unauthorized sign-in URL). */
  unauthorizedSignIn: {
    title: string;
    description: string;
    asideTitle: string;
    asideItems: string[];
    ctaSignIn: string;
    /** Short footer under the primary CTA (Sendero-wide messaging, not vendor-only). */
    footerNote: string;
  };
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
  /** Toasts + redirect when the user already has access or is on the list */
  waitlistPrecheck: {
    alreadySignedIn: string;
    alreadyOnWaitlist: string;
    invited: string;
    invitedCheckEmail: string;
    grantedAccess: string;
    allowlistAccess: string;
    alreadyJoinedSession: string;
    requestNotApproved: string;
  };
};

const AUTH_COPY: Record<string, AuthCopy> = {
  'en-US': {
    unauthorizedSignIn: {
      title: 'This sign-in was revoked.',
      description:
        'You removed a session from a device Clerk did not recognize. That session is finished—continue here when you are ready to sign in again on this device.',
      asideTitle: 'Security',
      asideItems: [
        'Clerk sends this flow when you revoke an unrecognized-device session from email or security alerts.',
        'Your account stays intact; only the suspicious session ends.',
        'If this was not you, sign in and update your password or security settings in Clerk.',
      ],
      ctaSignIn: 'Sign in again',
      footerNote: 'Sendero · Secure access',
    },
    signIn: {
      title: 'Welcome back.',
      description:
        'Sign in with Clerk to return to your Sendero workspace for traveler sessions, policies, channel adapters, metering, billing, and settlement.',
      asideTitle: 'Agentic workspace',
      asideItems: [
        'Protected routes stay behind Sendero access checks on the web (session and organization through Clerk).',
        'Organizations map to agencies, companies, operators, and agent clients.',
        'Traveler sessions, policies, channels, and action ledgers stay inside the app.',
      ],
    },
    signUp: {
      title: 'Sign up for hackathon access.',
      description:
        'Submit the live Sendero access form for the hackathon. Clerk captures the request now, then approved workspaces continue into organization setup, channel adapters, policy configuration, metering, and Arc settlement.',
      asideTitle: 'Hackathon access',
      asideItems: [
        'The access form is active inside the app site.',
        'Organization, channels, policies, and billing are configured after identity.',
        'Operators, agencies, companies, and agent clients all enter through the same Clerk flow.',
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
    waitlistPrecheck: {
      alreadySignedIn: "You're already signed in. Taking you to the app.",
      alreadyOnWaitlist: "You're already on the waitlist. Taking you to sign in.",
      invited: "You've been invited. Continue at sign in.",
      invitedCheckEmail:
        "You've been invited. If you have not finished setup, check your email for the link, then sign in.",
      grantedAccess: 'Your access is approved. Taking you to sign in.',
      allowlistAccess: "You're on the approved access list. Taking you to sign in.",
      alreadyJoinedSession: "You're already on the waitlist. Taking you to sign in.",
      requestNotApproved:
        'This access request is not approved. Contact us if you think this is a mistake.',
    },
  },
  'es-AR': {
    unauthorizedSignIn: {
      title: 'Este inicio de sesión fue revocado.',
      description:
        'Eliminaste una sesión desde un dispositivo que Clerk no reconoció. Esa sesión terminó: seguí acá cuando quieras volver a iniciar sesión en este dispositivo.',
      asideTitle: 'Seguridad',
      asideItems: [
        'Clerk te envía a este flujo cuando revocás una sesión de dispositivo no reconocido desde el mail o alertas de seguridad.',
        'Tu cuenta sigue intacta; solo termina la sesión sospechosa.',
        'Si no fuiste vos, iniciá sesión y actualizá contraseña o seguridad en Clerk.',
      ],
      ctaSignIn: 'Iniciar sesión de nuevo',
      footerNote: 'Sendero · Acceso seguro',
    },
    signIn: {
      title: 'Volvé a entrar.',
      description:
        'Ingresá con Clerk para volver a tu workspace de Sendero: sesiones de viaje, políticas, canales, medición, facturación y settlement.',
      asideTitle: 'Workspace del agente',
      asideItems: [
        'Las rutas protegidas quedan detrás de los controles de acceso de Sendero en la web (sesión y organización vía Clerk).',
        'Las organizaciones representan agencias, empresas, operadores y clientes agente.',
        'Sesiones, políticas, canales y ledger de acciones viven dentro de la app.',
      ],
    },
    signUp: {
      title: 'Registrate para el hackathon.',
      description:
        'Enviá el formulario activo de acceso a Sendero para el hackathon. Clerk toma la solicitud ahora; los workspaces aprobados siguen con organización, canales, políticas, medición y settlement en Arc.',
      asideTitle: 'Acceso hackathon',
      asideItems: [
        'El formulario de acceso está activo dentro de la app.',
        'Organización, canales, políticas y billing se configuran después de la identidad.',
        'Operadores, agencias, empresas y clientes agente entran por el mismo flujo de Clerk.',
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
    waitlistPrecheck: {
      alreadySignedIn: 'Ya iniciaste sesión. Te llevamos a la app.',
      alreadyOnWaitlist: 'Ya estás en la lista de espera. Te llevamos a iniciar sesión.',
      invited: 'Ya tenés una invitación. Continuá en iniciar sesión.',
      invitedCheckEmail:
        'Ya tenés una invitación. Si no terminaste el registro, revisá el email con el enlace y luego iniciá sesión.',
      grantedAccess: 'Tu acceso está aprobado. Te llevamos a iniciar sesión.',
      allowlistAccess: 'Estás en la lista de acceso aprobada. Te llevamos a iniciar sesión.',
      alreadyJoinedSession: 'Ya estás en la lista de espera. Te llevamos a iniciar sesión.',
      requestNotApproved:
        'Esta solicitud de acceso no fue aprobada. Escribinos si creés que es un error.',
    },
  },
  'es-MX': {
    unauthorizedSignIn: {
      title: 'Este inicio de sesión fue revocado.',
      description:
        'Eliminaste una sesión desde un dispositivo que Clerk no reconoció. Esa sesión terminó: continúa aquí cuando quieras iniciar sesión de nuevo en este dispositivo.',
      asideTitle: 'Seguridad',
      asideItems: [
        'Clerk te envía a este flujo cuando revocas una sesión de dispositivo no reconocido desde el correo o alertas de seguridad.',
        'Tu cuenta sigue intacta; solo termina la sesión sospechosa.',
        'Si no fuiste tú, inicia sesión y actualiza tu contraseña o seguridad en Clerk.',
      ],
      ctaSignIn: 'Iniciar sesión de nuevo',
      footerNote: 'Sendero · Acceso seguro',
    },
    signIn: {
      title: 'Bienvenido de vuelta.',
      description:
        'Inicia sesión con Clerk para volver a tu workspace de Sendero: viajeros, políticas, canales, medición, facturación y liquidación.',
      asideTitle: 'Workspace del agente',
      asideItems: [
        'Las rutas protegidas pasan por los controles de acceso de Sendero en la web (sesión y organización con Clerk).',
        'Las organizaciones representan agencias, empresas, operadores y clientes agente.',
        'Sesiones, políticas, canales y ledger de acciones se quedan dentro de la app.',
      ],
    },
    signUp: {
      title: 'Regístrate para el hackathon.',
      description:
        'Envía el formulario activo de acceso a Sendero para el hackathon. Clerk toma la solicitud ahora; los workspaces aprobados siguen con organización, canales, políticas, medición y liquidación en Arc.',
      asideTitle: 'Acceso hackathon',
      asideItems: [
        'El formulario de acceso está activo dentro de la app.',
        'Organización, canales, políticas y billing se configuran después de la identidad.',
        'Operadores, agencias, empresas y clientes agente entran por el mismo flujo de Clerk.',
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
    waitlistPrecheck: {
      alreadySignedIn: 'Ya iniciaste sesión. Te llevamos a la app.',
      alreadyOnWaitlist: 'Ya estás en la lista de espera. Te llevamos a iniciar sesión.',
      invited: 'Ya tienes una invitación. Continúa en iniciar sesión.',
      invitedCheckEmail:
        'Ya tienes una invitación. Si no terminaste el registro, revisa tu correo con el enlace y luego inicia sesión.',
      grantedAccess: 'Tu acceso está aprobado. Te llevamos a iniciar sesión.',
      allowlistAccess: 'Estás en la lista de acceso aprobada. Te llevamos a iniciar sesión.',
      alreadyJoinedSession: 'Ya estás en la lista de espera. Te llevamos a iniciar sesión.',
      requestNotApproved:
        'Esta solicitud de acceso no fue aprobada. Escríbenos si crees que es un error.',
    },
  },
  'pt-BR': {
    unauthorizedSignIn: {
      title: 'Este acesso foi revogado.',
      description:
        'Você encerrou uma sessão de um dispositivo que a Clerk não reconheceu. Essa sessão acabou—continue aqui quando quiser entrar de novo neste dispositivo.',
      asideTitle: 'Segurança',
      asideItems: [
        'A Clerk envia este fluxo quando você revoga uma sessão de dispositivo não reconhecido pelo e-mail ou alertas de segurança.',
        'Sua conta permanece; apenas a sessão suspeita termina.',
        'Se não foi você, entre e atualize a senha ou as configurações de segurança na Clerk.',
      ],
      ctaSignIn: 'Entrar novamente',
      footerNote: 'Sendero · Acesso seguro',
    },
    signIn: {
      title: 'Bem-vindo de volta.',
      description:
        'Entre com Clerk para voltar ao workspace Sendero: viajantes, políticas, canais, medição, billing e liquidação.',
      asideTitle: 'Workspace do agente',
      asideItems: [
        'Rotas protegidas ficam atrás dos controles de acesso Sendero na web (sessão e organização via Clerk).',
        'Organizações representam agências, empresas, operadores e clientes agente.',
        'Sessões, políticas, canais e ledger de ações ficam dentro do app.',
      ],
    },
    signUp: {
      title: 'Cadastre-se para o hackathon.',
      description:
        'Envie o formulário ativo de acesso ao Sendero para o hackathon. O Clerk captura a solicitação agora; workspaces aprovados seguem para organização, canais, políticas, medição e liquidação na Arc.',
      asideTitle: 'Acesso hackathon',
      asideItems: [
        'O formulário de acesso está ativo dentro do app.',
        'Organização, canais, políticas e billing são configurados depois da identidade.',
        'Operadores, agências, empresas e clientes agente entram pelo mesmo fluxo Clerk.',
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
    waitlistPrecheck: {
      alreadySignedIn: 'Você já está logado. Redirecionando para o app.',
      alreadyOnWaitlist: 'Você já está na lista de espera. Redirecionando para entrar.',
      invited: 'Você já foi convidado. Continue em entrar.',
      invitedCheckEmail:
        'Você já foi convidado. Se ainda não concluiu, verifique o email com o link e entre em seguida.',
      grantedAccess: 'Seu acesso foi aprovado. Redirecionando para entrar.',
      allowlistAccess: 'Você está na lista de acesso aprovada. Redirecionando para entrar.',
      alreadyJoinedSession: 'Você já está na lista de espera. Redirecionando para entrar.',
      requestNotApproved:
        'Este pedido de acesso não foi aprovado. Fale conosco se achar que é um engano.',
    },
  },
};

export function getAuthCopy(locale: string | null | undefined): AuthCopy {
  const normalized = normalizeLocale(locale) ?? 'en-US';
  return AUTH_COPY[normalized] ?? AUTH_COPY['en-US'];
}
