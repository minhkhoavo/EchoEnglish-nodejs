import { Schema } from 'mongoose';

export function addBaseFields(schema: Schema) {
    schema.add({
        isDeleted: { type: Boolean, default: false },
    });
}

export function setBaseOptions(schema: Schema) {
    schema.set('timestamps', true);
}
