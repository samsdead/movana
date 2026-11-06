import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Import the actual pure animation calculation before the React component.
const source=await readFile(new URL('../src/Tutor.jsx',import.meta.url),'utf8');
const calculation=source.slice(source.indexOf('export function salsaPoseAt'),source.indexOf('export default function Tutor'));
const {salsaPoseAt}=await import(`data:text/javascript,${encodeURIComponent(calculation)}`);

test('salsa holds both feet and torso still throughout counts four and eight',()=>{
  for(const start of [3,7]){
    const held=salsaPoseAt(start);
    for(const delta of [0.01,0.25,0.5,0.99])assert.deepEqual(salsaPoseAt(start+delta),held);
    assert.deepEqual(held,[82,118,0]);
  }
});

test('salsa steps match learner directions, recover, and close before the hold',()=>{
  const left=salsaPoseAt(.25),right=salsaPoseAt(4.25);
  assert.ok(left[0]<82&&left[2]<0);
  assert.ok(right[1]>118&&right[2]>0);
  assert.equal(salsaPoseAt(1.25)[2],0);
  assert.equal(salsaPoseAt(5.25)[2],0);
  assert.deepEqual(salsaPoseAt(2.25),[82,118,0]);
  assert.deepEqual(salsaPoseAt(6.25),[82,118,0]);
  assert.deepEqual(salsaPoseAt(8.25),left);
});
