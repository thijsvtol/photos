/**
 * Extract initials from a user's name or email
 * @param name - User's full name (nullable)
 * @param email - User's email address
 * @returns 1-2 letter initials in uppercase
 */
export function getInitials(name: string | null, email: string): string {
  if (name && name.trim()) {
    // Extract first letter of first two words
    const words = name.trim().split(/\s+/);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    // Single word name - take first 2 characters or just 1
    return words[0].substring(0, 2).toUpperCase();
  }
  
  // Fallback to first letter of email
  return email[0].toUpperCase();
}

/**
 * Generate a consistent color class for an avatar based on email
 * Uses a simple hash function to map emails to one of 8 colors
 * @param email - User's email address
 * @returns Tailwind background color class
 */
export function getAvatarColor(email: string): string {
  // Simple hash function: sum of character codes
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash += email.charCodeAt(i);
  }
  
  // Map to one of 8 color classes
  const colors = [
    'bg-blue-500',
    'bg-green-500',
    'bg-purple-500',
    'bg-pink-500',
    'bg-indigo-500',
    'bg-red-500',
    'bg-yellow-500',
    'bg-teal-500',
  ];
  
  return colors[hash % colors.length];
}
