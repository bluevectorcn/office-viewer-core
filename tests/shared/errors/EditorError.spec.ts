import { describe, it, expect } from 'vitest';
import { EditorError, ErrorCode } from '@/shared/errors/EditorError';

describe('EditorError', () => {
  it('should create error with code and message', () => {
    const error = new EditorError(
      ErrorCode.OPEN_FAILED,
      'Failed to open document'
    );

    expect(error.code).toBe(ErrorCode.OPEN_FAILED);
    expect(error.message).toBe('Failed to open document');
    expect(error.name).toBe('EditorError');
  });

  it('should include cause when provided', () => {
    const originalError = new Error('Network timeout');
    const error = new EditorError(
      ErrorCode.NETWORK_ERROR,
      'Request failed',
      originalError
    );

    expect(error.cause).toBe(originalError);
  });

  it('should include context when provided', () => {
    const error = new EditorError(
      ErrorCode.SAVE_FAILED,
      'Save operation failed',
      undefined,
      { docId: 'doc-123', attempt: 3 }
    );

    expect(error.context).toEqual({ docId: 'doc-123', attempt: 3 });
  });

  it('should convert to JSON correctly', () => {
    const originalError = new Error('Original error');
    const error = new EditorError(
      ErrorCode.CONVERSION_FAILED,
      'Conversion failed',
      originalError,
      { fileType: 'docx' }
    );

    const json = error.toJSON();

    expect(json.name).toBe('EditorError');
    expect(json.code).toBe(ErrorCode.CONVERSION_FAILED);
    expect(json.message).toBe('Conversion failed');
    expect(json.context).toEqual({ fileType: 'docx' });
    expect(json.cause).toHaveProperty('message', 'Original error');
  });

  it('should check error code with is() method', () => {
    const error = new EditorError(ErrorCode.NO_SESSION, 'No session');

    expect(error.is(ErrorCode.NO_SESSION)).toBe(true);
    expect(error.is(ErrorCode.OPEN_FAILED)).toBe(false);
  });

  it('should create error using factory method', () => {
    const error = EditorError.create(
      ErrorCode.RESOURCE_DISPOSED,
      'Resource already disposed'
    );

    expect(error).toBeInstanceOf(EditorError);
    expect(error.code).toBe(ErrorCode.RESOURCE_DISPOSED);
  });

  it('should convert from unknown error', () => {
    const unknownError = new Error('Unknown error');
    const error = EditorError.from(
      unknownError,
      ErrorCode.OPEN_FAILED,
      'Default message'
    );

    expect(error).toBeInstanceOf(EditorError);
    expect(error.code).toBe(ErrorCode.OPEN_FAILED);
    expect(error.message).toBe('Unknown error');
    expect(error.cause).toBe(unknownError);
  });

  it('should return existing EditorError when converting', () => {
    const originalError = new EditorError(ErrorCode.SAVE_FAILED, 'Save failed');
    const convertedError = EditorError.from(
      originalError,
      ErrorCode.OPEN_FAILED,
      'Default'
    );

    expect(convertedError).toBe(originalError);
  });
});
