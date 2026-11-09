import mongoose, { Schema, model, InferSchemaType, Types } from 'mongoose';

export const CONSENT_PURPOSES = [
    'analytics',
    'personalization',
    'research',
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/** Current consent state, one doc per user. Absence of a doc == nothing granted (never pre-set). */
const consentSchema = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
        },
        policyVersion: { type: String, required: true },
        purposes: {
            analytics: { type: Boolean, default: false },
            personalization: { type: Boolean, default: false },
            research: { type: Boolean, default: false },
        },
        updatedAt: { type: Date, default: Date.now },
    },
    { collection: 'recsys_consents', versionKey: false }
);

/**
 * Append-only proof of consent (who agreed to what text, when, from where).
 * Kept even after erasure of learning data because the controller must be able to
 * demonstrate consent; it holds no learning content. Counsel to confirm retention period.
 */
const ledgerSchema = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, required: true, index: true },
        policyVersion: { type: String, required: true },
        purpose: { type: String, enum: CONSENT_PURPOSES, required: true },
        granted: { type: Boolean, required: true },
        at: { type: Date, default: Date.now },
        channel: {
            type: String,
            enum: ['web', 'ios', 'android', 'api'],
            default: 'api',
        },
    },
    { collection: 'recsys_consent_ledger', versionKey: false }
);

export type ConsentDoc = InferSchemaType<typeof consentSchema> & {
    _id: Types.ObjectId;
};

export const Consent =
    mongoose.models.RecsysConsent ||
    model<ConsentDoc>('RecsysConsent', consentSchema);
export const ConsentLedger =
    mongoose.models.RecsysConsentLedger ||
    model('RecsysConsentLedger', ledgerSchema);
