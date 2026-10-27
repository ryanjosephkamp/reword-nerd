declare module 'pako/lib/zlib/zstream.js' {
 export default class ZStream {input:Uint8Array;next_in:number;avail_in:number;total_in:number;output:Uint8Array;next_out:number;avail_out:number;total_out:number;msg:string}
}
declare module 'pako/lib/zlib/inflate.js' {
 import ZStream from 'pako/lib/zlib/zstream.js';
 export function inflateInit2(s:ZStream,windowBits:number):number;
 export function inflate(s:ZStream,flush:number):number;
 export function inflateEnd(s:ZStream):number;
}
