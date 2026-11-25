// The URL a QR code opens on the listening device (R24). No mode hint: the decoder learns the
// payload kind from the stream itself, and a shorter URL keeps the QR at version 3 (design D10).
export function receiveUrl(origin: string): string {
  return `${origin}/receive`;
}
