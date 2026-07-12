// Turns identifiers like "subjectVerbAgreement", "SPECIFIC_ACTION", or
// "error_correction" into readable text like "Subject Verb Agreement" /
// "Specific Action" / "Error Correction".
export function humanizeLabel(value: string): string {
    const words = value
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .trim()
        .split(/\s+/);

    return words
        .map(
            (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        )
        .join(' ');
}
