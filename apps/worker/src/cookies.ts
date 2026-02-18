import type { EventSession } from './types';

/**
 * Signs a value using HMAC-SHA256
 */
async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(value)
  );
  
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verifies a signed value
 */
async function verify(value: string, signature: string, secret: string): Promise<boolean> {
  const expectedSignature = await sign(value, secret);
  return expectedSignature === signature;
}

/**
 * Base64 encode a string (works in Workers)
 */
function base64Encode(str: string): string {
  return btoa(str);
}

/**
 * Base64 decode a string (works in Workers)
 */
function base64Decode(str: string): string {
  return atob(str);
}

/**
 * Creates a signed session cookie for an event
 */
export async function createEventCookie(
  eventSlug: string,
  secret: string
): Promise<string> {
  const session: EventSession = {
    eventSlug,
    authenticated: true,
    timestamp: Date.now()
  };
  
  const value = JSON.stringify(session);
  const signature = await sign(value, secret);
  const cookieValue = `${base64Encode(value)}.${signature}`;
  
  // Session-only cookie (no Max-Age/Expires)
  return `ev_${eventSlug}=${cookieValue}; HttpOnly; Secure; SameSite=Lax; Path=/`;
}

/**
 * Verifies and parses an event session cookie
 */
export async function verifyEventCookie(
  cookieValue: string,
  secret: string
): Promise<EventSession | null> {
  try {
    const [encodedValue, signature] = cookieValue.split('.');
    if (!encodedValue || !signature) {
      return null;
    }
    
    const value = base64Decode(encodedValue);
    const isValid = await verify(value, signature, secret);
    
    if (!isValid) {
      return null;
    }
    
    const session: EventSession = JSON.parse(value);
    if (!session.authenticated || !session.eventSlug) {
      return null;
    }
    
    return session;
  } catch {
    return null;
  }
}

/**
 * Gets event session from request cookies
 */
export async function getEventSession(
  request: Request,
  eventSlug: string,
  secret: string
): Promise<boolean> {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) {
    return false;
  }
  
  const cookies = cookieHeader.split(';').map(c => c.trim());
  const eventCookie = cookies.find(c => c.startsWith(`ev_${eventSlug}=`));
  
  if (!eventCookie) {
    return false;
  }
  
  const cookieValue = eventCookie.substring(`ev_${eventSlug}=`.length);
  const session = await verifyEventCookie(cookieValue, secret);
  
  return session !== null && session.eventSlug === eventSlug && session.authenticated;
}
