export function createBucket(missingKeys: Set<string> = new Set()) {
  return {
    get: async (key: string) => {
      if (missingKeys.has(key)) {
        return null;
      }
      return {
        arrayBuffer: async () => new ArrayBuffer(8),
      };
    },
    createMultipartUpload: async (key: string) => {
      return {
        uploadId: `upload-${key}`,
        key,
      };
    },
    resumeMultipartUpload: (_key: string, _uploadId: string) => {
      return {
        uploadPart: async (_partNumber: number, _body: ArrayBuffer) => ({ etag: 'etag' }),
        complete: async (_parts: Array<{ partNumber: number; etag: string }>) => {},
      };
    },
    delete: async () => {},
  };
}
