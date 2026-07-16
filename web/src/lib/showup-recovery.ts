import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const RECOVERY_CODE_PREFIX = "SUP1";
const RECOVERY_CODE_VERSION = 1;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const AAD = Buffer.from("showup-recovery-v1", "utf8");

type RecoveryPayload = {
  version: number;
  userId: string;
  createdAt: string;
};

function getRecoveryKey(): Buffer {
  const secret = process.env.SHOWUP_RECOVERY_SECRET?.trim();

  if (!secret) {
    throw new Error(
      "SHOWUP_RECOVERY_SECRET is not configured.",
    );
  }

  if (!/^[a-fA-F0-9]{64}$/.test(secret)) {
    throw new Error(
      "SHOWUP_RECOVERY_SECRET must be a 64-character hexadecimal value.",
    );
  }

  return Buffer.from(secret, "hex");
}

function isValidCircleUserId(userId: string): boolean {
  return (
    userId.length >= 5 &&
    userId.length <= 50 &&
    /^[a-zA-Z0-9_-]+$/.test(userId)
  );
}

function encodePart(value: Buffer): string {
  return value.toString("base64url");
}

function decodePart(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export function createShowUpRecoveryCode(
  userId: string,
): string {
  const normalizedUserId = userId.trim();

  if (!isValidCircleUserId(normalizedUserId)) {
    throw new Error("Invalid Circle user ID.");
  }

  const payload: RecoveryPayload = {
    version: RECOVERY_CODE_VERSION,
    userId: normalizedUserId,
    createdAt: new Date().toISOString(),
  };

  const key = getRecoveryKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(
    "aes-256-gcm",
    key,
    iv,
    {
      authTagLength: AUTH_TAG_LENGTH,
    },
  );

  cipher.setAAD(AAD);

  const encrypted = Buffer.concat([
    cipher.update(
      JSON.stringify(payload),
      "utf8",
    ),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    RECOVERY_CODE_PREFIX,
    encodePart(iv),
    encodePart(encrypted),
    encodePart(authTag),
  ].join(".");
}

export function readShowUpRecoveryCode(
  recoveryCode: string,
): RecoveryPayload {
  const normalizedCode = recoveryCode.trim();

  if (
    normalizedCode.length < 20 ||
    normalizedCode.length > 2048
  ) {
    throw new Error("Invalid ShowUp recovery code.");
  }

  const parts = normalizedCode.split(".");

  if (
    parts.length !== 4 ||
    parts[0] !== RECOVERY_CODE_PREFIX
  ) {
    throw new Error("Invalid ShowUp recovery code.");
  }

  try {
    const iv = decodePart(parts[1]);
    const encrypted = decodePart(parts[2]);
    const authTag = decodePart(parts[3]);

    if (
      iv.length !== IV_LENGTH ||
      authTag.length !== AUTH_TAG_LENGTH ||
      encrypted.length === 0
    ) {
      throw new Error("Invalid recovery code structure.");
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      getRecoveryKey(),
      iv,
      {
        authTagLength: AUTH_TAG_LENGTH,
      },
    );

    decipher.setAAD(AAD);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    const payload = JSON.parse(
      decrypted.toString("utf8"),
    ) as Partial<RecoveryPayload>;

    if (
      payload.version !== RECOVERY_CODE_VERSION ||
      typeof payload.userId !== "string" ||
      !isValidCircleUserId(payload.userId) ||
      typeof payload.createdAt !== "string"
    ) {
      throw new Error("Invalid recovery payload.");
    }

    return {
      version: payload.version,
      userId: payload.userId,
      createdAt: payload.createdAt,
    };
  } catch {
    throw new Error(
      "The ShowUp recovery code is invalid or has been modified.",
    );
  }
}