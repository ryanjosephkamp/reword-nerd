import {describe,it,expect} from 'vitest';
import {JOB_LIMITS,validateResultBudget} from './runner';
describe('aggregate output custody budget',()=>{
 it('allows the exact cumulative byte and pixel boundary',()=>{
  expect(()=>validateResultBudget(Array.from({length:4},()=>({byteLength:JOB_LIMITS.resultBytes,width:4096,height:2048})))).not.toThrow();
 });
 it('rejects many individually allowed outputs before review string allocation',()=>{
  expect(()=>validateResultBudget(Array.from({length:5},()=>({byteLength:JOB_LIMITS.resultBytes,width:320,height:200})))).toThrow(/budget/);
 });
 it('bounds decoded history even when PNG output is highly compressed',()=>{
  expect(()=>validateResultBudget(Array.from({length:3},()=>({byteLength:1024,width:4096,height:4096})))).toThrow(/budget/);
 });
});
