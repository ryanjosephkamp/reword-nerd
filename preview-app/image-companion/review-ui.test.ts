// @vitest-environment jsdom
import {Blob as NodeBlob} from 'node:buffer';
import {createElement} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {setup} from './reviewTestFixture';
import {ReviewDetail} from '../src/app/platform/reviews/ReviewImports';
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
it('deterministic UI association: explicit click, stale selection, removal; no acceptance or receipt changes',async()=>{
 vi.stubGlobal('Blob',NodeBlob);Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=> 'blob:owned-test')});Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});
 const {review,state,bundle}=await setup();const original=JSON.stringify(review.registration),entry={review,bundle,bundleHash:'480f52ff9dfca6e95f28b4795dcdfa9b8526e2196c66ab1728e3587d9bf1130d',name:'owned.zip',retainedBytes:bundle.length};
 const ui=render(createElement(ReviewDetail,{entry,imageState:state,onRemove:()=>undefined}));
 expect(screen.getByRole('button',{name:'Associate selected image'}).hasAttribute('disabled')).toBe(false);expect(screen.queryByText(/Associated with the matching/)).toBeNull();
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Associate selected image'}));});expect(screen.getByText(/Associated with the matching/)).toBeTruthy();
 ui.rerender(createElement(ReviewDetail,{entry,imageState:{...state,reviewGeneration:2},onRemove:()=>undefined}));expect(screen.getByText(/Previous association is stale/)).toBeTruthy();expect(screen.getByRole('button',{name:'Associate selected image'}).hasAttribute('disabled')).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Remove association'}));expect(screen.queryByText(/Previous association is stale/)).toBeNull();expect(JSON.stringify(review.registration)).toBe(original);expect(review.checked.current.status).toBe('failed');
});
it('explicit user action records stale association separately and retains prior decision revisions',async()=>{
 const {webcrypto}=await import('node:crypto');vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('Blob',NodeBlob);const blobs:Blob[]=[];Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn((blob:Blob)=>{blobs.push(blob);return 'blob:owned-test';})});Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
 const {review,state,bundle}=await setup();const original=JSON.stringify(review),entry={review,bundle,bundleHash:'480f52ff9dfca6e95f28b4795dcdfa9b8526e2196c66ab1728e3587d9bf1130d',name:'owned.zip',retainedBytes:bundle.length};
 const ui=render(createElement(ReviewDetail,{entry,imageState:state,onRemove:()=>undefined}));fireEvent.click(screen.getByRole('button',{name:'Associate selected image'}));ui.rerender(createElement(ReviewDetail,{entry,imageState:{...state,reviewGeneration:2},onRemove:()=>undefined}));
 fireEvent.change(screen.getByLabelText('Your review notes'),{target:{value:'SYNTHETIC UI TEST — stale selected source; review retained output only.'}});fireEvent.change(screen.getByLabelText('Decision for this revision'),{target:{value:'request-changes'}});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Save user revision 1'}));});await screen.findByText('User revision history (1)');
 fireEvent.change(screen.getByLabelText('Your review notes'),{target:{value:'Additional notes; decision unchanged.'}});fireEvent.change(screen.getByLabelText('Decision for this revision'),{target:{value:'notes-only'}});await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Save user revision 2'}));});
 await screen.findByText('User revision history (2)');expect(screen.getByText('Latest explicit user decision: Request changes (revision 1).')).toBeTruthy();await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Export user decision history'}));});
 await waitFor(()=>expect(blobs.at(-1)?.type).toBe('application/json'));const raw=JSON.parse(await blobs.at(-1)!.text());expect(raw.actions).toHaveLength(2);expect(raw.actions[0].association.status).toBe('stale-at-action');expect(raw.actions[1].decision).toBe('notes-only');expect(JSON.stringify(review)).toBe(original);
});
