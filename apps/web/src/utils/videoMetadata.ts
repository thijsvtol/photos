/**
 * Extracts the creation time embedded in an MP4/MOV file by parsing the
 * Movie Header Box (`mvhd`). Timestamps in MP4 files use the QuickTime epoch
 * (1904-01-01 00:00:00 UTC) rather than the Unix epoch.
 *
 * @param buffer - ArrayBuffer containing (at least the beginning of) the MP4 file
 * @returns ISO 8601 string of the recording time, or undefined if not available
 */
export function extractMp4CreationTime(buffer: ArrayBuffer): string | undefined {
  try {
    const view = new DataView(buffer);
    const length = view.byteLength;

    // Minimum bytes required after finding the 'mvhd' type to safely read
    // version (1 byte), flags (3 bytes), and a 32-bit creation_time (4 bytes):
    // 4 (type already consumed by scan) + 1 + 3 + 4 = 12, but we need up to
    // i+16 for the 64-bit variant, so guard with 20 bytes.
    const MIN_MVHD_TRAILING_BYTES = 20;

    // 2^32 – used to combine the high and low 32-bit words of a 64-bit timestamp
    const UINT32_MAX_PLUS_ONE = 0x100000000;

    // Locate the 'mvhd' box by scanning for its 4-byte type signature.
    // Box layout: [size(4)] [type(4)='mvhd'] [version(1)] [flags(3)] [creation_time(4 or 8)]
    // When we find 'mvhd' at index i, version is at i+4 and creation_time starts at i+8.
    for (let i = 0; i < length - MIN_MVHD_TRAILING_BYTES; i++) {
      if (
        view.getUint8(i)     === 0x6D && // 'm'
        view.getUint8(i + 1) === 0x76 && // 'v'
        view.getUint8(i + 2) === 0x68 && // 'h'
        view.getUint8(i + 3) === 0x64    // 'd'
      ) {
        const version = view.getUint8(i + 4);
        let creationTimeSeconds: number;

        if (version === 1) {
          // 64-bit timestamp (version 1 box)
          const high = view.getUint32(i + 8);
          const low = view.getUint32(i + 12);
          creationTimeSeconds = high * UINT32_MAX_PLUS_ONE + low;
        } else {
          // 32-bit timestamp (version 0 box)
          creationTimeSeconds = view.getUint32(i + 8);
        }

        // A zero value means the field was not set
        if (creationTimeSeconds === 0) {
          return undefined;
        }

        // Convert from QuickTime/MP4 epoch (1904-01-01) to Unix epoch (1970-01-01).
        // The difference is exactly 2082844800 seconds.
        const MAC_EPOCH_DIFF = 2082844800;
        const unixTimestampMs = (creationTimeSeconds - MAC_EPOCH_DIFF) * 1000;

        const date = new Date(unixTimestampMs);

        // Sanity-check: must be after 2000-01-01 and not more than one day in the future
        const minDate = new Date('2000-01-01').getTime();
        const maxDate = Date.now() + 86400000;
        if (date.getTime() >= minDate && date.getTime() <= maxDate) {
          return date.toISOString();
        }

        return undefined;
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}
