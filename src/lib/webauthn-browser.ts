function base64UrlToArrayBuffer(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bytesToBase64Url(value: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizeCreationOptions(input: Record<string, unknown>): PublicKeyCredentialCreationOptions {
  const user = input.user as Record<string, unknown>;
  const excludeCredentials = Array.isArray(input.excludeCredentials)
    ? input.excludeCredentials.map((item) => {
        const row = item as Record<string, unknown>;
        return {
          ...row,
          id: base64UrlToArrayBuffer(String(row.id || "")),
        } as unknown as PublicKeyCredentialDescriptor;
      })
    : undefined;

  return {
    ...(input as unknown as PublicKeyCredentialCreationOptions),
    challenge: base64UrlToArrayBuffer(String(input.challenge || "")),
    user: {
      ...(user as unknown as PublicKeyCredentialUserEntity),
      id: base64UrlToArrayBuffer(String(user?.id || "")),
    },
    excludeCredentials,
  };
}

function normalizeRequestOptions(input: Record<string, unknown>): PublicKeyCredentialRequestOptions {
  const allowCredentials = Array.isArray(input.allowCredentials)
    ? input.allowCredentials.map((item) => {
        const row = item as Record<string, unknown>;
        return {
          ...row,
          id: base64UrlToArrayBuffer(String(row.id || "")),
        } as unknown as PublicKeyCredentialDescriptor;
      })
    : undefined;

  return {
    ...(input as unknown as PublicKeyCredentialRequestOptions),
    challenge: base64UrlToArrayBuffer(String(input.challenge || "")),
    allowCredentials,
  };
}

export async function createPasskey(
  options: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!window.PublicKeyCredential || !navigator.credentials?.create) {
    throw new Error("Browser/perangkat ini belum mendukung Passkey/WebAuthn");
  }

  const credential = (await navigator.credentials.create({
    publicKey: normalizeCreationOptions(options),
  })) as PublicKeyCredential | null;

  if (!credential) throw new Error("Pendaftaran passkey dibatalkan");

  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: bytesToBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: bytesToBase64Url(response.clientDataJSON),
      attestationObject: bytesToBase64Url(response.attestationObject),
      transports:
        typeof response.getTransports === "function" ? response.getTransports() : [],
    },
  };
}

export async function getPasskey(
  options: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!window.PublicKeyCredential || !navigator.credentials?.get) {
    throw new Error("Browser/perangkat ini belum mendukung Passkey/WebAuthn");
  }

  const credential = (await navigator.credentials.get({
    publicKey: normalizeRequestOptions(options),
  })) as PublicKeyCredential | null;

  if (!credential) throw new Error("Autentikasi passkey dibatalkan");

  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: bytesToBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: bytesToBase64Url(response.clientDataJSON),
      authenticatorData: bytesToBase64Url(response.authenticatorData),
      signature: bytesToBase64Url(response.signature),
      userHandle: response.userHandle ? bytesToBase64Url(response.userHandle) : undefined,
    },
  };
}
