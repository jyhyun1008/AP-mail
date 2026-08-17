/** The `Signature` header on an inbound request failed to verify (bad/missing signature, digest mismatch, or unresolvable key). */
export class SignatureVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignatureVerificationError";
  }
}

/** A remote actor document could not be fetched or did not contain the expected shape (publicKey/inbox). */
export class UnknownActorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnknownActorError";
  }
}
