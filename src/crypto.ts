import { decodeData, type Data } from "./domain.ts";

const PBKDF2_ITERATIONS = 150_000;

export interface PinLockRecord {
  hash: string;
  salt: string;
}

export interface EncryptedBackupEnvelope {
  format: "finacc-encrypted-v1";
  kdf: "pbkdf2-sha256";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("Некорректные данные шифрования.");
  }
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function importSecretKey(secret: string): Promise<CryptoKey> {
  const encoded = new TextEncoder().encode(secret);
  return crypto.subtle.importKey("raw", encoded, "PBKDF2", false, [
    "deriveBits",
    "deriveKey",
  ]);
}

export async function hashPin(
  pin: string,
  saltHex?: string,
): Promise<PinLockRecord> {
  const trimmed = pin.trim();
  if (!/^\d{4,8}$/.test(trimmed)) {
    throw new Error("PIN-код должен содержать от 4 до 8 цифр.");
  }
  const saltBytes = saltHex
    ? fromHex(saltHex)
    : crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const key = await importSecretKey(trimmed);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return {
    hash: toHex(new Uint8Array(bits)),
    salt: toHex(saltBytes),
  };
}

export async function verifyPin(
  pin: string,
  record: PinLockRecord,
): Promise<boolean> {
  if (!/^\d{4,8}$/.test(pin.trim())) return false;
  try {
    const candidate = await hashPin(pin, record.salt);
    if (candidate.hash.length !== record.hash.length) return false;
    let diff = 0;
    for (let i = 0; i < candidate.hash.length; i++) {
      diff |= candidate.hash.charCodeAt(i) ^ record.hash.charCodeAt(i);
    }
    return diff === 0;
  } catch {
    return false;
  }
}

async function deriveAesKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  usage: ("encrypt" | "decrypt")[],
): Promise<CryptoKey> {
  const baseKey = await importSecretKey(passphrase);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    usage,
  );
}

export async function encryptBackup(
  data: Data,
  passphrase: string,
): Promise<string> {
  if (passphrase.length < 4) {
    throw new Error("Пароль для копии должен быть не короче 4 символов.");
  }
  const validated = decodeData(data);
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const key = await deriveAesKey(passphrase, salt, PBKDF2_ITERATIONS, [
    "encrypt",
  ]);
  const plaintext = new TextEncoder().encode(JSON.stringify(validated));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );
  const envelope: EncryptedBackupEnvelope = {
    format: "finacc-encrypted-v1",
    kdf: "pbkdf2-sha256",
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(encrypted)),
  };
  return JSON.stringify(envelope, null, 2);
}

export function isEncryptedBackup(
  value: unknown,
): value is EncryptedBackupEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Partial<EncryptedBackupEnvelope>;
  return (
    v.format === "finacc-encrypted-v1" &&
    v.kdf === "pbkdf2-sha256" &&
    typeof v.iterations === "number" &&
    Number.isSafeInteger(v.iterations) &&
    v.iterations >= 10_000 &&
    v.iterations <= 2_000_000 &&
    typeof v.salt === "string" &&
    typeof v.iv === "string" &&
    typeof v.ciphertext === "string"
  );
}

export async function decryptBackup(
  envelope: unknown,
  passphrase: string,
): Promise<Data> {
  if (!isEncryptedBackup(envelope)) {
    throw new Error("Файл не является зашифрованной резервной копией finacc.");
  }
  if (!passphrase) {
    throw new Error("Введите пароль для расшифровки копии.");
  }
  try {
    const salt = fromBase64(envelope.salt);
    const iv = fromBase64(envelope.iv);
    const ciphertext = fromBase64(envelope.ciphertext);
    const key = await deriveAesKey(
      passphrase,
      salt,
      envelope.iterations,
      ["decrypt"],
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext,
    );
    const parsed: unknown = JSON.parse(new TextDecoder().decode(decrypted));
    return decodeData(parsed);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Файл поврежден")
    ) {
      throw error;
    }
    throw new Error(
      "Неверный пароль или поврежденная зашифрованная резервная копия.",
    );
  }
}
