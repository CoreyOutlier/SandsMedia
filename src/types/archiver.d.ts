declare module "archiver" {
  import { Transform, Readable } from "node:stream";
  export class ZipArchive extends Transform {
    constructor(options?:{zlib?:{level:number}});
    append(source:Readable|string|Buffer,data:{name:string}):this;
    finalize():Promise<void>;
    abort():this;
  }
}
