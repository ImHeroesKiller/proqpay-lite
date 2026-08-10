export function validateMakerChecker(creatorUserId: string, approverUserId: string) {
  return creatorUserId && approverUserId && creatorUserId !== approverUserId
    ? { allowed: true, error: null }
    : { allowed: false, error: 'Pembuat payment instruction tidak boleh menyetujui instruksi yang sama.' };
}

export function reconcilePayment(expected: number, instructionLines: Array<{ amount: number }>, proofs: Array<{ amount: number }>) {
  const instructionTotal = instructionLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const proofTotal = proofs.reduce((sum, proof) => sum + Number(proof.amount || 0), 0);
  const instructionDifference = instructionTotal - expected;
  const proofDifference = proofTotal - expected;
  const status = instructionDifference === 0 && proofDifference === 0 ? 'MATCHED'
    : proofTotal === 0 ? 'PENDING_REVIEW'
    : proofTotal < expected ? 'PARTIAL' : 'MISMATCH';
  return { expected, instructionTotal, proofTotal, instructionDifference, proofDifference, status } as const;
}
