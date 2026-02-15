import { describe, it, expect } from 'vitest';
import {
  CTSError,
  OllamaNotRunningError,
  OllamaVersionError,
  ModelLoadTimeoutError,
  GenerationTimeoutError,
  ModelNotFoundError,
  QueueFullError,
  RateLimitError,
  PromptInjectionError,
  ContextOverflowError,
  InvalidConfigError,
  ctsErrorToCallToolResult,
} from '../../src/errors.js';

describe('CTSError', () => {
  it('E-01: sets basic properties', () => {
    const err = new CTSError('CTS-1001', 'test', { httpStatus: 503, retryable: true });
    expect(err.code).toBe('CTS-1001');
    expect(err.message).toBe('test');
    expect(err.httpStatus).toBe(503);
    expect(err.retryable).toBe(true);
    expect(err.fallbackToCloud).toBe(true);
    expect(err.timestamp).toBeTruthy();
  });

  it('E-02: supports Error.cause chain', () => {
    const cause = new Error('original');
    const err = new CTSError('CTS-1001', 'wrapped', { cause });
    expect(err.cause).toBe(cause);
  });

  it('E-03: toMCPError serializes correctly', () => {
    const err = new CTSError('CTS-4001', 'queue full', { retryable: false });
    const mcp = err.toMCPError();
    expect(mcp.code).toBe('CTS-4001');
    expect(mcp.message).toBe('queue full');
    expect(mcp.retryable).toBe(false);
  });
});

describe('OllamaNotRunningError', () => {
  it('E-04: default message', () => {
    const err = new OllamaNotRunningError();
    expect(err.code).toBe('CTS-1001');
    expect(err.retryable).toBe(true);
    expect(err.fallbackToCloud).toBe(true);
  });

  it('accepts custom message', () => {
    const err = new OllamaNotRunningError('custom msg');
    expect(err.message).toBe('custom msg');
    expect(err.code).toBe('CTS-1001');
  });
});

describe('OllamaVersionError', () => {
  it('E-05: formats version message', () => {
    const err = new OllamaVersionError('0.1.20', '0.1.34');
    expect(err.code).toBe('CTS-1002');
    expect(err.message).toContain('0.1.20');
    expect(err.message).toContain('0.1.34');
  });

  it('accepts custom message', () => {
    const err = new OllamaVersionError('custom version error');
    expect(err.message).toBe('custom version error');
  });
});

describe('ModelLoadTimeoutError', () => {
  it('E-06: stores timeoutMs', () => {
    const err = new ModelLoadTimeoutError('phi4:latest', 60000);
    expect(err.code).toBe('CTS-2001');
    expect(err.timeoutMs).toBe(60000);
    expect(err.fallbackToCloud).toBe(true);
  });
});

describe('GenerationTimeoutError', () => {
  it('E-07: stores tier', () => {
    const err = new GenerationTimeoutError(90000, 2);
    expect(err.code).toBe('CTS-2002');
    expect(err.tier).toBe(2);
    expect(err.timeoutMs).toBe(90000);
  });

  it('accepts message + timeoutMs pattern', () => {
    const err = new GenerationTimeoutError('custom timeout', 30000);
    expect(err.message).toBe('custom timeout');
    expect(err.timeoutMs).toBe(30000);
  });
});

describe('ModelNotFoundError', () => {
  it('E-08: sets retryable true, fallbackToCloud false', () => {
    const err = new ModelNotFoundError('phi4:latest');
    expect(err.code).toBe('CTS-3001');
    expect(err.retryable).toBe(true);
    expect(err.fallbackToCloud).toBe(false);
  });
});

describe('QueueFullError', () => {
  it('E-09: includes size info', () => {
    const err = new QueueFullError(10, 10);
    expect(err.code).toBe('CTS-4001');
    expect(err.message).toContain('10/10');
  });
});

describe('RateLimitError', () => {
  it('E-10: retryable true', () => {
    const err = new RateLimitError(10);
    expect(err.code).toBe('CTS-4002');
    expect(err.retryable).toBe(true);
  });
});

describe('PromptInjectionError', () => {
  it('E-11: not retryable, no fallback', () => {
    const err = new PromptInjectionError('direct-override');
    expect(err.code).toBe('CTS-5001');
    expect(err.retryable).toBe(false);
    expect(err.fallbackToCloud).toBe(false);
  });
});

describe('ContextOverflowError', () => {
  it('E-12: includes token info', () => {
    const err = new ContextOverflowError(50000, 4000, 1);
    expect(err.code).toBe('CTS-5002');
    expect(err.message).toContain('50000');
  });
});

describe('InvalidConfigError', () => {
  it('E-13: includes key and reason', () => {
    const err = new InvalidConfigError('baseUrl', 'invalid format');
    expect(err.code).toBe('CTS-6001');
    expect(err.message).toContain('baseUrl');
  });
});

describe('ctsErrorToCallToolResult', () => {
  it('E-14: converts CTSError with fallback', () => {
    const err = new OllamaNotRunningError();
    const result = ctsErrorToCallToolResult(err);
    expect(result.isError).toBe(true);
    expect(result.content[0]).toHaveProperty('text');
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('CTS-1001');
    expect(text).toContain('FALLBACK');
  });

  it('E-15: converts non-CTSError', () => {
    const result = ctsErrorToCallToolResult(new Error('generic'));
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('CTS-0000');
  });
});
