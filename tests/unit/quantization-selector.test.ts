import { describe, it, expect } from 'vitest';
import { selectQuantization } from '../../src/model-selector/quantization-selector.js';
import type { QuantizationVariant } from '../../src/model-selector/types.js';

const variants: QuantizationVariant[] = [
  { quantization: 'Q4_K_M', vramRequired: 4.5, qualityRank: 3, speedRank: 1 },
  { quantization: 'Q5_K_M', vramRequired: 5.5, qualityRank: 2, speedRank: 2 },
  { quantization: 'Q8_0', vramRequired: 8.0, qualityRank: 1, speedRank: 3 },
];

describe('selectQuantization (DMS-031)', () => {
  it('returns undefined for empty variants array', () => {
    const result = selectQuantization({
      variants: [],
      availableVramGB: 16,
      preferQuality: false,
    });
    expect(result).toBeUndefined();
  });

  it('preferQuality=true selects highest quality (lowest qualityRank) within VRAM', () => {
    const result = selectQuantization({
      variants,
      availableVramGB: 10,
      preferQuality: true,
    });
    expect(result).toBeDefined();
    expect(result!.variant.quantization).toBe('Q8_0');
    expect(result!.exceedsVram).toBe(false);
  });

  it('preferQuality=false selects fastest (lowest speedRank) within VRAM', () => {
    const result = selectQuantization({
      variants,
      availableVramGB: 10,
      preferQuality: false,
    });
    expect(result).toBeDefined();
    expect(result!.variant.quantization).toBe('Q4_K_M');
    expect(result!.exceedsVram).toBe(false);
  });

  it('filters variants that exceed available VRAM', () => {
    const result = selectQuantization({
      variants,
      availableVramGB: 6,
      preferQuality: true,
    });
    // Only Q4_K_M (4.5) and Q5_K_M (5.5) fit
    expect(result).toBeDefined();
    expect(result!.variant.quantization).toBe('Q5_K_M'); // qualityRank 2 is best among fitting
    expect(result!.exceedsVram).toBe(false);
  });

  it('falls back to smallest variant if no variant fits VRAM (exceedsVram=true)', () => {
    const result = selectQuantization({
      variants,
      availableVramGB: 2,
      preferQuality: true,
    });
    expect(result).toBeDefined();
    expect(result!.variant.quantization).toBe('Q4_K_M'); // smallest vramRequired
    expect(result!.exceedsVram).toBe(true);
  });

  it('all variants fit: preferQuality=true picks quality, =false picks speed', () => {
    const qualityResult = selectQuantization({
      variants,
      availableVramGB: 16,
      preferQuality: true,
    });
    expect(qualityResult!.variant.quantization).toBe('Q8_0'); // qualityRank 1

    const speedResult = selectQuantization({
      variants,
      availableVramGB: 16,
      preferQuality: false,
    });
    expect(speedResult!.variant.quantization).toBe('Q4_K_M'); // speedRank 1
  });

  it('exactly one variant fits: returns that variant', () => {
    const result = selectQuantization({
      variants,
      availableVramGB: 5, // Only Q4_K_M (4.5) fits
      preferQuality: true,
    });
    expect(result).toBeDefined();
    expect(result!.variant.quantization).toBe('Q4_K_M');
    expect(result!.exceedsVram).toBe(false);
  });

  it('tie-breaking: consistent result when ranks are equal', () => {
    const tiedVariants: QuantizationVariant[] = [
      { quantization: 'A', vramRequired: 4.0, qualityRank: 1, speedRank: 1 },
      { quantization: 'B', vramRequired: 5.0, qualityRank: 1, speedRank: 1 },
    ];

    const result1 = selectQuantization({
      variants: tiedVariants,
      availableVramGB: 10,
      preferQuality: true,
    });
    const result2 = selectQuantization({
      variants: tiedVariants,
      availableVramGB: 10,
      preferQuality: true,
    });

    // Should return consistently the same variant
    expect(result1!.variant.quantization).toBe(result2!.variant.quantization);
  });

  it('large VRAM: all variants fit, preference determines choice', () => {
    const result = selectQuantization({
      variants,
      availableVramGB: 128,
      preferQuality: true,
    });
    expect(result!.variant.quantization).toBe('Q8_0');
    expect(result!.exceedsVram).toBe(false);
  });

  it('small VRAM: only smallest fits', () => {
    const result = selectQuantization({
      variants,
      availableVramGB: 4.5, // Exactly Q4_K_M
      preferQuality: false,
    });
    expect(result).toBeDefined();
    expect(result!.variant.quantization).toBe('Q4_K_M');
    expect(result!.exceedsVram).toBe(false);
  });
});
