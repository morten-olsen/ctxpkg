/**
 * Tests for agent module:
 * - Response parsing
 * - Retry logic
 * - Error detection
 */

import { describe, it, expect, vi } from 'vitest';

import { isRetryableError, withRetry } from '../src/agent/agent.js';
import { formatUserPrompt, formatCollectionRestriction } from '../src/agent/agent.prompts.js';

describe('agent', () => {
  describe('isRetryableError', () => {
    it('returns true for rate limit errors', () => {
      expect(isRetryableError(new Error('rate limit exceeded'))).toBe(true);
      expect(isRetryableError(new Error('Error 429: Too many requests'))).toBe(true);
      expect(isRetryableError(new Error('too many requests'))).toBe(true);
    });

    it('returns true for server errors', () => {
      expect(isRetryableError(new Error('500 Internal Server Error'))).toBe(true);
      expect(isRetryableError(new Error('502 Bad Gateway'))).toBe(true);
      expect(isRetryableError(new Error('503 Service Unavailable'))).toBe(true);
      expect(isRetryableError(new Error('504 Gateway Timeout'))).toBe(true);
    });

    it('returns true for network errors', () => {
      expect(isRetryableError(new Error('ECONNRESET'))).toBe(true);
      expect(isRetryableError(new Error('ETIMEDOUT'))).toBe(true);
      expect(isRetryableError(new Error('network error'))).toBe(true);
    });

    it('returns false for non-retryable errors', () => {
      expect(isRetryableError(new Error('Invalid API key'))).toBe(false);
      expect(isRetryableError(new Error('Bad request'))).toBe(false);
      expect(isRetryableError(new Error('Not found'))).toBe(false);
      expect(isRetryableError(new Error('Unauthorized'))).toBe(false);
    });

    it('returns false for non-Error values', () => {
      expect(isRetryableError('string error')).toBe(false);
      expect(isRetryableError(null)).toBe(false);
      expect(isRetryableError(undefined)).toBe(false);
    });
  });

  describe('withRetry', () => {
    it('returns result on first success', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await withRetry(fn, {
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 2,
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on retryable error', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('rate limit'))
        .mockRejectedValueOnce(new Error('rate limit'))
        .mockResolvedValue('success');

      const result = await withRetry(fn, {
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 2,
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('throws immediately on non-retryable error', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Invalid API key'));

      await expect(
        withRetry(fn, {
          maxRetries: 3,
          initialDelayMs: 10,
          maxDelayMs: 100,
          backoffMultiplier: 2,
        }),
      ).rejects.toThrow('Invalid API key');

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('throws after max retries', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('rate limit'));

      await expect(
        withRetry(fn, {
          maxRetries: 2,
          initialDelayMs: 10,
          maxDelayMs: 100,
          backoffMultiplier: 2,
        }),
      ).rejects.toThrow('rate limit');

      expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });

    it('calls onRetry callback', async () => {
      const fn = vi.fn().mockRejectedValueOnce(new Error('rate limit')).mockResolvedValue('success');

      const onRetry = vi.fn();

      await withRetry(
        fn,
        {
          maxRetries: 3,
          initialDelayMs: 10,
          maxDelayMs: 100,
          backoffMultiplier: 2,
        },
        onRetry,
      );

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), 10);
    });
  });

  describe('formatUserPrompt', () => {
    it('formats basic prompt', () => {
      const prompt = formatUserPrompt('How do I do X?', 'Building an app');

      expect(prompt).toContain('How do I do X?');
      expect(prompt).toContain('Building an app');
      expect(prompt).toContain('## Question');
      expect(prompt).toContain('## Use Case');
    });

    it('includes collection restriction when provided', () => {
      const prompt = formatUserPrompt('How do I do X?', 'Building an app', ['docs', 'api-docs']);

      expect(prompt).toContain('docs, api-docs');
      expect(prompt).toContain('Restrict your searches');
    });

    it('does not include collection note when not provided', () => {
      const prompt = formatUserPrompt('How do I do X?', 'Building an app');

      expect(prompt).not.toContain('Restrict your searches');
    });

    it('handles empty collections array', () => {
      const prompt = formatUserPrompt('How do I do X?', 'Building an app', []);

      expect(prompt).not.toContain('Restrict your searches');
    });
  });

  describe('formatCollectionRestriction', () => {
    it('returns empty string for empty array', () => {
      expect(formatCollectionRestriction([])).toBe('');
    });

    it('formats single collection', () => {
      const restriction = formatCollectionRestriction(['my-docs']);

      expect(restriction).toContain('"my-docs"');
      expect(restriction).toContain('IMPORTANT');
      expect(restriction).toContain('collections');
    });

    it('formats multiple collections', () => {
      const restriction = formatCollectionRestriction(['docs', 'api', 'guides']);

      expect(restriction).toContain('"docs"');
      expect(restriction).toContain('"api"');
      expect(restriction).toContain('"guides"');
    });
  });
});

describe('agent types', () => {
  describe('AgentResponse', () => {
    it('schema validates correct response', async () => {
      const { agentResponseSchema } = await import('../src/agent/agent.types.js');

      const result = agentResponseSchema.safeParse({
        answer: 'The answer is 42',
        sources: [{ collection: 'docs', document: 'guide.md', section: 'Intro' }],
        confidence: 'high',
      });

      expect(result.success).toBe(true);
    });

    it('schema rejects invalid confidence', async () => {
      const { agentResponseSchema } = await import('../src/agent/agent.types.js');

      const result = agentResponseSchema.safeParse({
        answer: 'The answer',
        sources: [],
        confidence: 'very-high',
      });

      expect(result.success).toBe(false);
    });

    it('schema allows optional note', async () => {
      const { agentResponseSchema } = await import('../src/agent/agent.types.js');

      const result = agentResponseSchema.safeParse({
        answer: 'The answer',
        sources: [],
        confidence: 'medium',
        note: 'Additional information',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.note).toBe('Additional information');
      }
    });
  });

  describe('Source schema', () => {
    it('validates source with section', async () => {
      const { sourceSchema } = await import('../src/agent/agent.types.js');

      const result = sourceSchema.safeParse({
        collection: 'my-docs',
        document: 'readme.md',
        section: 'Getting Started',
      });

      expect(result.success).toBe(true);
    });

    it('validates source without section', async () => {
      const { sourceSchema } = await import('../src/agent/agent.types.js');

      const result = sourceSchema.safeParse({
        collection: 'my-docs',
        document: 'readme.md',
      });

      expect(result.success).toBe(true);
    });
  });
});
