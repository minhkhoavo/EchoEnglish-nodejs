import { Schema } from 'mongoose';

export function baseEntityPlugin(schema: Schema) {
    schema.add({
        isDeleted: { type: Boolean, default: false },
    });
    schema.set('timestamps', true);
}
