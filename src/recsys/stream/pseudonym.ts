import { createHmac } from 'node:crypto';
import { recsysConfig } from '../config.js';

const MIN_SALT_LENGTH = 16;
const KNOWN_PLACEHOLDERS = new Set(['dev-only-salt', 'changeme', 'secret']);

export class PseudonymConfigError extends Error {}

/** Returns the secret or throws: analytics exports must never run with a guessable key. */
export function requirePseudonymSalt(
    salt: string | undefined = recsysConfig.pseudonymSalt()
): string {
    if (
        !salt ||
        salt.length < MIN_SALT_LENGTH ||
        KNOWN_PLACEHOLDERS.has(salt)
    ) {
        throw new PseudonymConfigError(
            `RECSYS_PSEUDONYM_SALT must be set to a secret of at least ${MIN_SALT_LENGTH} characters before any analytics export`
        );
    }
    return salt;
}

/**
 * Stable, keyed pseudonym for a learner. Scoped per region so records cannot be joined across
 * residency boundaries. This is pseudonymisation, NOT anonymisation: the data stays personal data.
 */
export function pseudonymise(
    userId: string,
    region: string,
    salt: string = requirePseudonymSalt()
): string {
    return createHmac('sha256', salt)
        .update(`${region}:${userId}`)
        .digest('hex')
        .slice(0, 32);
}
