import { describe, it, expect } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import { isNonRetryableUploadError } from '../services/uploadManager';

function makeAxiosError(status: number | undefined): AxiosError {
  const error = new AxiosError('Request failed');
  if (status !== undefined) {
    error.response = {
      status,
      statusText: '',
      headers: new AxiosHeaders(),
      config: { headers: new AxiosHeaders() } as never,
      data: {},
    };
  }
  return error;
}

describe('isNonRetryableUploadError', () => {
  it('treats 400/401/403/404/413/422 as non-retryable', () => {
    for (const status of [400, 401, 403, 404, 413, 422]) {
      expect(isNonRetryableUploadError(makeAxiosError(status))).toBe(true);
    }
  });

  it('treats 5xx and 429 as retryable', () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(isNonRetryableUploadError(makeAxiosError(status))).toBe(false);
    }
  });

  it('treats network errors with no response as retryable', () => {
    expect(isNonRetryableUploadError(makeAxiosError(undefined))).toBe(false);
  });

  it('treats non-axios errors as retryable', () => {
    expect(isNonRetryableUploadError(new Error('boom'))).toBe(false);
    expect(isNonRetryableUploadError('some string')).toBe(false);
  });
});
