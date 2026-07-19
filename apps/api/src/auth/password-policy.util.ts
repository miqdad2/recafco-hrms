const MIN_PASSWORD_LENGTH = 8;
const HAS_LETTER = /[A-Za-z]/;
const HAS_NUMBER_OR_SYMBOL = /[^A-Za-z]/;

/**
 * Deliberately permissive: HR needs to hand out simple, memorable temporary passwords
 * (the default `Recafco@{employeeCode}` format) rather than a random-generator-grade policy.
 * Returns a human-readable error message, or null if the password passes.
 */
export function validatePasswordPolicy(password: string, username: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`;
  }
  if (!HAS_LETTER.test(password)) {
    return 'Password must include at least one letter';
  }
  if (!HAS_NUMBER_OR_SYMBOL.test(password)) {
    return 'Password must include at least one number or symbol';
  }
  if (password === username) {
    return 'Password cannot be the same as the username';
  }
  return null;
}
