import { afterEach, expect, it, vi } from 'vitest';
import { copyText } from '../src/app/workbench/copyText';
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();document.body.replaceChildren();});
it('does not select a fallback after the originating mode becomes inactive',async()=>{
 vi.stubGlobal('isSecureContext',true);
 let rejectCopy!:(reason:Error)=>void;
 const clipboard={writeText:vi.fn(()=>new Promise<void>((_resolve,reject)=>{rejectCopy=reject;}))};
 vi.stubGlobal('navigator',{clipboard});
 const panel=document.createElement('section');const trigger=document.createElement('button');panel.append(trigger);document.body.append(panel);trigger.focus();
 const result=copyText('Owned synthetic clipboard fixture');
 panel.hidden=true;panel.setAttribute('inert','');
 const other=document.createElement('button');document.body.append(other);other.focus();
 rejectCopy(new Error('clipboard unavailable'));
 await expect(result).resolves.toBe('select-manually');
 expect(document.activeElement).toBe(other);expect(document.querySelector('textarea')).toBeNull();
});
