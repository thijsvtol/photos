/**
 * Generates a random salt for password hashing
 */
export function generateSalt(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Hashes a password with the given salt using SHA-256
 * Format: sha256(salt + ':' + password)
 */
export async function hashPassword(password: string, salt: string): Promise<string> {
  const message = `${salt}:${password}`;
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verifies a password against stored salt and hash
 */
export async function verifyPassword(
  password: string,
  salt: string,
  hash: string
): Promise<boolean> {
  const computedHash = await hashPassword(password, salt);
  return computedHash === hash;
}

/**
 * Generates a slug from a string (lowercase, replace spaces with hyphens, remove special chars)
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 50);
}

/**
 * Generates a unique slug by appending a number if needed
 * Maximum 100 attempts to prevent infinite loops
 */
export async function generateUniqueSlug(
  db: D1Database,
  baseName: string
): Promise<string> {
  let slug = generateSlug(baseName);
  let counter = 1;
  const maxAttempts = 100;
  
  while (counter <= maxAttempts) {
    const existing = await db
      .prepare('SELECT id FROM events WHERE slug = ?')
      .bind(slug)
      .first();
    
    if (!existing) {
      return slug;
    }
    
    slug = `${generateSlug(baseName)}-${counter}`;
    counter++;
  }
  
  // If we've exhausted attempts, throw an error
  throw new Error(`Unable to generate unique slug after ${maxAttempts} attempts`);
}

/**
 * Extracts just the first name from a person's full name (e.g. "Jane Doe" -> "Jane").
 *
 * Used to only expose a person cluster's FIRST name (see person_clusters.name and
 * routes/me.ts) to the account holder's own non-admin view (the Timeline's "Just me" filter
 * toggle) — the full name an admin enters (e.g. "Jane Doe") stays admin-only (see
 * routes/admin/people.ts), same as how the rest of the app treats a person's admin-entered
 * display data as internal.
 */
export function firstNameOf(fullName: string | null | undefined): string | null {
  if (!fullName) return null;
  const trimmed = fullName.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0];
}
