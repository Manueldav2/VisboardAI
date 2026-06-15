/**
 * Claim Registry — prevents duplicate claims from being flagged.
 * Uses normalized text comparison with word-overlap similarity.
 */

export class ClaimRegistry {
  private claims = new Map<string, { original: string; timestamp: number }>();

  private normalize(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private wordOverlap(a: string, b: string): number {
    const wordsA = new Set(a.split(' ').filter(w => w.length > 2));
    const wordsB = new Set(b.split(' ').filter(w => w.length > 2));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    const intersection = [...wordsA].filter(w => wordsB.has(w));
    return (2 * intersection.length) / (wordsA.size + wordsB.size);
  }

  /** Returns true if this claim is NEW (not seen before). */
  register(claim: string): boolean {
    const normalized = this.normalize(claim);
    if (normalized.length < 5) return false;

    for (const [existing] of this.claims) {
      if (this.wordOverlap(normalized, existing) > 0.70) {
        return false;
      }
    }

    this.claims.set(normalized, { original: claim, timestamp: Date.now() });
    return true;
  }

  /** Check if claim exists without registering */
  has(claim: string): boolean {
    const normalized = this.normalize(claim);
    for (const [existing] of this.claims) {
      if (this.wordOverlap(normalized, existing) > 0.70) return true;
    }
    return false;
  }

  getAllClaims(): string[] {
    return [...this.claims.values()].map(c => c.original);
  }

  clear(): void {
    this.claims.clear();
  }

  get size(): number {
    return this.claims.size;
  }
}
