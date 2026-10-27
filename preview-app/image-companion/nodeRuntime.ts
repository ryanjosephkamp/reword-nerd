import {createHash} from 'node:crypto';
import {inflateSync,inflateRawSync} from 'node:zlib';
import type {ReviewRuntime} from './portable/runtime';
export const nodeRuntime:ReviewRuntime={hash:async value=>createHash('sha256').update(value).digest('hex'),inflate(bytes,limit,raw){const r=(raw?inflateRawSync:inflateSync)(bytes,{maxOutputLength:limit,info:true}) as unknown as {buffer:Uint8Array;engine:{bytesWritten:number}};return {buffer:r.buffer,consumed:r.engine.bytesWritten};}};
