const PBKDF2_ITERATIONS = 210000;
const KEY_LENGTH = 32;

function toBase64(bytes: Uint8Array): string {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;

  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }

  return diff === 0;
}

export function generateSixDigitCode(): string {
  const random = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(random).padStart(6, '0');
}

export async function hashPassword(password: string, salt?: Uint8Array): Promise<{ hash: string; salt: string }> {
  const resolvedSalt = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey('raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: resolvedSalt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    key,
    KEY_LENGTH * 8,
  );

  return {
    hash: toBase64(new Uint8Array(derivedBits)),
    salt: toBase64(resolvedSalt),
  };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const saltBytes = fromBase64(salt);
  const computed = await hashPassword(password, saltBytes);

  return timingSafeEqual(fromBase64(computed.hash), fromBase64(hash));
}
