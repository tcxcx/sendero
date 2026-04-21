import { SignJWT, jwtVerify } from 'jose';

export interface InvoiceTokenPayload {
  iid: string;
  tenantId: string;
}

function secretKey(secret: string): Uint8Array {
  if (!secret || secret.length < 16) {
    throw new Error('invoice signing secret must be at least 16 characters');
  }
  return new TextEncoder().encode(secret);
}

export async function signInvoiceToken(
  payload: InvoiceTokenPayload,
  secret: string
): Promise<string> {
  return await new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .sign(secretKey(secret));
}

export async function verifyInvoiceToken(
  token: string,
  secret: string
): Promise<InvoiceTokenPayload> {
  const { payload } = await jwtVerify(token, secretKey(secret), {
    algorithms: ['HS256'],
  });
  if (typeof payload.iid !== 'string' || typeof payload.tenantId !== 'string') {
    throw new Error('invalid invoice token payload');
  }
  return { iid: payload.iid, tenantId: payload.tenantId };
}
