export default class AWSError extends Error {
    private readonly status;
    private readonly type;
    constructor(status: number, type: string, message: string);
    static isType(e: unknown, type: string): boolean;
    isType(type: string): boolean;
    isTransient(): boolean;
}
//# sourceMappingURL=AWSError.d.ts.map