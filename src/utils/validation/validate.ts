export function validateDob(value: Date): boolean {
    if (!value) return true;
    const now = new Date();
    const minAge = 6;
    const age =
        now.getFullYear() -
        value.getFullYear() -
        (now < new Date(now.getFullYear(), value.getMonth(), value.getDate())
            ? 1
            : 0);
    return age >= minAge;
}
