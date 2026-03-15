const secretPatterns = [
  /(discord[_-]?token\s*[:=]\s*)(\S+)/gi,
  /(authorization\s*[:=]\s*)(\S+)/gi,
];

export function sanitizeForLog(input: string): string {
  return secretPatterns.reduce(
    (output, pattern) => output.replace(pattern, "$1[REDACTED]"),
    input,
  );
}
