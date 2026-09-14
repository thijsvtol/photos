export function createBucket(missingKeys: Set<string> = new Set()) {
  return {
    get: async (key: string) => {
      if (missingKeys.has(key)) {
        return null;
      }
      const bytes = new Uint8Array(8);
      return {
        arrayBuffer: async () => bytes.buffer,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
      };
    },
    head: async (key: string) => {
      if (missingKeys.has(key)) {
        return null;
      }
      return { key };
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
        abort: async () => {},
      };
    },
    delete: async () => {},
  };
}
