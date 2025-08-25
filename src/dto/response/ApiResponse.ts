class ApiResponse<T> {
    private _message: string;
    private _data?: T;

    constructor(message: string, data?: T) {
        this._message = message;
        this._data = data;
    }

    get message(): string {
        return this._message;
    }

    get data(): T | undefined {
        return this._data;
    }
}

export default ApiResponse;