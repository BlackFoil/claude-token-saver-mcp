import { describe, it, expect } from 'vitest';
import {
  CTSError,
  OllamaConnectionError,
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

  it('E-06b: uses model name for auto-generated message (no space)', () => {
    const err = new ModelLoadTimeoutError('phi4:latest', 30000);
    expect(err.message).toContain('phi4:latest');
    expect(err.message).toContain('30');
  });

  it('E-06c: uses custom message when contains space', () => {
    const err = new ModelLoadTimeoutError('First token not received within 5000ms', 5000);
    expect(err.message).toBe('First token not received within 5000ms');
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

describe('OllamaConnectionError direct construction', () => {
  it('E-18: accepts code and message (CTS-1001)', () => {
    const err = new OllamaConnectionError('CTS-1001', 'connection refused');
    expect(err.code).toBe('CTS-1001');
    expect(err.message).toBe('connection refused');
  });

  it('E-19: accepts code and message (CTS-1002)', () => {
    const err = new OllamaConnectionError('CTS-1002', 'version mismatch');
    expect(err.code).toBe('CTS-1002');
    expect(err.message).toBe('version mismatch');
  });

  it('E-20: accepts plain message (non-code string) defaults to CTS-1001', () => {
    const err = new OllamaConnectionError('some connection error');
    expect(err.code).toBe('CTS-1001');
    expect(err.message).toBe('some connection error');
  });

  it('E-21: passes cause through to constructor', () => {
    const cause = new Error('root cause');
    const err = new OllamaConnectionError('CTS-1001', 'msg', cause);
    expect(err.cause).toBe(cause);
  });

  it('E-27: code without message uses code as message fallback', () => {
    const err = new OllamaConnectionError('CTS-1001');
    expect(err.code).toBe('CTS-1001');
    expect(err.message).toBe('CTS-1001');
  });
});

describe('OllamaNotRunningError with Error argument', () => {
  it('E-22: uses Error as cause when message is Error', () => {
    const cause = new Error('original error');
    const err = new OllamaNotRunningError(cause);
    expect(err.message).toBe('Ollamaが起動していません。`ollama serve` を実行してください。');
    expect(err.cause).toBe(cause);
  });

  it('E-23: uses separate cause parameter', () => {
    const cause = new Error('root');
    const err = new OllamaNotRunningError('custom msg', cause);
    expect(err.message).toBe('custom msg');
    expect(err.cause).toBe(cause);
  });
});

describe('CTSError defaults', () => {
  it('E-24: defaults httpStatus to 500', () => {
    const err = new CTSError('CTS-1001', 'test');
    expect(err.httpStatus).toBe(500);
  });

  it('E-25: defaults retryable to false', () => {
    const err = new CTSError('CTS-1001', 'test');
    expect(err.retryable).toBe(false);
  });

  it('E-26: defaults fallbackToCloud to true', () => {
    const err = new CTSError('CTS-1001', 'test');
    expect(err.fallbackToCloud).toBe(true);
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

  it('E-16: converts CTSError without fallback but retryable', () => {
    const err = new RateLimitError(10);
    const result = ctsErrorToCallToolResult(err);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('CTS-4002');
    expect(text).toContain('RETRY');
  });

  it('E-17: converts non-Error value', () => {
    const result = ctsErrorToCallToolResult('string error');
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('string error');
  });
});
