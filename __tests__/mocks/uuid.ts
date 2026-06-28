import { randomUUID } from 'crypto';

export const v4 = () => randomUUID();
export const v1 = () => randomUUID();
export const v3 = () => randomUUID();
export const v5 = () => randomUUID();
export const validate = () => true;
export const version = () => 4;
export const NIL = '00000000-0000-0000-0000-000000000000';
export const MAX = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

export default { v4, v1, v3, v5, validate, version, NIL, MAX };
