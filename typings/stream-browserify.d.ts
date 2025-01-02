declare module "stream-browserify" {
    export class Stream {
        constructor(...args: any[]);
        [key: string]: any;
    }

    export class PassThrough extends Stream {
        constructor(...args: any[]);
        [key: string]: any;
    }

    export class Transform extends Stream {
        constructor(...args: any[]);
        [key: string]: any;
    }
}
