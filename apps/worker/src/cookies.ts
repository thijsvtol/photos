import type { EventSession } from './types';

const EVENT_SESSION_HEADER = 'X-Event-Session';
const EVENT_SESSIONS_HEADER = 'X-Event-Sessions';
const EVENT_SESSION_QUERY_PARAM = 'est';

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
  const cookieValue = await createEventSessionToken(eventSlug, secret);

  // Persist for 7 days so the user doesn't have to re-enter the event password
  return `ev_${eventSlug}=${cookieValue}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`;
}

/**
 * Creates a signed event session token value that can be used in headers/query params.
 */
export async function createEventSessionToken(
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
  return `${base64Encode(value)}.${signature}`;
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

/**
 * Checks whether the request has event-session access via cookie, header(s), or query token.
 */
export async function hasEventSessionAccess(
  request: Request,
  eventSlug: string,
  secret: string
): Promise<boolean> {
  const hasCookieSession = await getEventSession(request, eventSlug, secret);
  if (hasCookieSession) {
    return true;
  }

  const singleToken = request.headers.get(EVENT_SESSION_HEADER);
  if (singleToken) {
    const session = await verifyEventCookie(singleToken, secret);
    if (session && session.eventSlug === eventSlug && session.authenticated) {
      return true;
    }
  }

  const listHeader = request.headers.get(EVENT_SESSIONS_HEADER);
  if (listHeader) {
    try {
      const tokenMap = JSON.parse(listHeader) as Record<string, string>;
      const token = tokenMap?.[eventSlug];
      if (token) {
        const session = await verifyEventCookie(token, secret);
        if (session && session.eventSlug === eventSlug && session.authenticated) {
          return true;
        }
      }
    } catch {
      // Ignore malformed token map header.
    }
  }

  try {
    const requestUrl = new URL(request.url);
    const queryToken = requestUrl.searchParams.get(EVENT_SESSION_QUERY_PARAM);
    if (queryToken) {
      const session = await verifyEventCookie(queryToken, secret);
      if (session && session.eventSlug === eventSlug && session.authenticated) {
        return true;
      }
    }
  } catch {
    // Ignore malformed request URL.
  }

  return false;
}
