import { describe, it, expect } from 'vitest';
import { sanitizeOutput } from '../../src/validators/prompt-guard.js';

describe('Output Sanitization: API Keys', () => {
  it('OS-01: redacts Anthropic API key (sk-...)', () => {
    const result = sanitizeOutput(
      'Here is the key: sk-ant1234567890abcdefghij and more text',
    );
    expect(result.sanitized).toContain('[REDACTED:API_KEY]');
    expect(result.sanitized).not.toContain('sk-ant1234567890abcdefghij');
    expect(result.detectedCategories).toContain('api-key-anthropic');
    expect(result.redactionCount).toBe(1);
  });

  it('OS-02: redacts OpenAI API key (sk-proj-...)', () => {
    const result = sanitizeOutput(
      'export OPENAI_API_KEY=sk-proj-abcdef123456_GHIJKL789012 end',
    );
    expect(result.sanitized).toContain('[REDACTED:API_KEY]');
    expect(result.sanitized).not.toContain('sk-proj-');
    expect(result.detectedCategories).toContain('api-key-openai');
  });

  it('OS-03: redacts GitHub PAT (ghp_...)', () => {
    const result = sanitizeOutput(
      'git clone https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/repo',
    );
    expect(result.sanitized).toContain('[REDACTED:GITHUB_TOKEN]');
    expect(result.sanitized).not.toContain('ghp_');
    expect(result.detectedCategories).toContain('github-pat');
  });

  it('OS-04: redacts GitHub OAuth (gho_...)', () => {
    const result = sanitizeOutput(
      'TOKEN=gho_abcdefghijklmnopqrstuvwxyz0123456789 done',
    );
    expect(result.sanitized).toContain('[REDACTED:GITHUB_TOKEN]');
    expect(result.detectedCategories).toContain('github-oauth');
  });

  it('OS-05: redacts npm token', () => {
    const result = sanitizeOutput(
      '//registry.npmjs.org/:_authToken=npm_abcdefghijklmnopqrstuvwxyz0123456789',
    );
    expect(result.sanitized).toContain('[REDACTED:NPM_TOKEN]');
    expect(result.detectedCategories).toContain('npm-token');
  });

  it('OS-06: redacts AWS access key', () => {
    const result = sanitizeOutput(
      'aws_access_key_id = AKIAIOSFODNN7EXAMPLE done',
    );
    expect(result.sanitized).toContain('[REDACTED:AWS_KEY]');
    expect(result.detectedCategories).toContain('aws-access-key');
  });
});

describe('Output Sanitization: Credentials', () => {
  it('OS-07: redacts password fields', () => {
    const result = sanitizeOutput(
      'DB config: password=SuperSecret123! host=localhost',
    );
    expect(result.sanitized).toContain('[REDACTED:PASSWORD]');
    expect(result.sanitized).not.toContain('SuperSecret123');
    expect(result.detectedCategories).toContain('password');
  });

  it('OS-08: redacts password with quotes', () => {
    const result = sanitizeOutput(
      'password="my_secret_pass" and passwd=\'another_pass\'',
    );
    expect(result.sanitized).toContain('[REDACTED:PASSWORD]');
    expect(result.sanitized).not.toContain('my_secret_pass');
    expect(result.detectedCategories).toContain('password');
  });

  it('OS-09: redacts private keys', () => {
    const result = sanitizeOutput(
      '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADA...\n-----END PRIVATE KEY-----',
    );
    expect(result.sanitized).toContain('[REDACTED:PRIVATE_KEY]');
    expect(result.sanitized).not.toContain('MIIEvQIBADA');
    expect(result.detectedCategories).toContain('private-key');
  });

  it('OS-10: redacts RSA private keys', () => {
    const result = sanitizeOutput(
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----',
    );
    expect(result.sanitized).toContain('[REDACTED:PRIVATE_KEY]');
    expect(result.detectedCategories).toContain('private-key');
  });
});

describe('Output Sanitization: Connection Strings', () => {
  it('OS-11: redacts MongoDB connection string', () => {
    const result = sanitizeOutput(
      'MONGO_URI=mongodb://admin:password123@mongo.example.com:27017/mydb',
    );
    expect(result.sanitized).toContain('[REDACTED:CONNECTION_STRING]');
    expect(result.sanitized).not.toContain('password123');
  });

  it('OS-12: redacts PostgreSQL connection string', () => {
    const result = sanitizeOutput(
      'postgres://user:pass@db.example.com:5432/prod',
    );
    expect(result.sanitized).toContain('[REDACTED:CONNECTION_STRING]');
    expect(result.detectedCategories).toContain('connection-string');
  });

  it('OS-13: redacts Redis connection string', () => {
    const result = sanitizeOutput(
      'REDIS_URL=redis://default:secret@redis.example.com:6379',
    );
    expect(result.sanitized).toContain('[REDACTED:CONNECTION_STRING]');
  });
});

describe('Output Sanitization: JWT & File Paths', () => {
  it('OS-14: redacts JWT tokens', () => {
    const result = sanitizeOutput(
      'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.Sfl_kxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    );
    expect(result.sanitized).toContain('[REDACTED:JWT]');
    expect(result.detectedCategories).toContain('jwt');
  });

  it('OS-15: redacts Unix file paths', () => {
    const result = sanitizeOutput(
      'Reading config from /Users/john/Documents/secrets/config.json',
    );
    expect(result.sanitized).toContain('[REDACTED:FILE_PATH]');
    expect(result.sanitized).not.toContain('/Users/john');
  });

  it('OS-16: redacts /home/ paths', () => {
    const result = sanitizeOutput(
      'File located at /home/deploy/.ssh/id_rsa',
    );
    expect(result.sanitized).toContain('[REDACTED:FILE_PATH]');
  });
});

describe('Output Sanitization: Multiple & Edge Cases', () => {
  it('OS-17: redacts multiple secrets in one output', () => {
    const result = sanitizeOutput(
      'KEY=sk-ant1234567890abcdefghij DB=postgres://user:pass@host:5432/db',
    );
    expect(result.redactionCount).toBeGreaterThanOrEqual(2);
    expect(result.sanitized).not.toContain('sk-ant');
    expect(result.sanitized).not.toContain('postgres://');
  });

  it('OS-18: returns clean text unchanged', () => {
    const cleanText = 'function sort(arr: number[]): number[] { return arr.sort(); }';
    const result = sanitizeOutput(cleanText);
    expect(result.sanitized).toBe(cleanText);
    expect(result.redactionCount).toBe(0);
    expect(result.detectedCategories).toHaveLength(0);
  });

  it('OS-19: handles empty string', () => {
    const result = sanitizeOutput('');
    expect(result.sanitized).toBe('');
    expect(result.redactionCount).toBe(0);
  });
});
