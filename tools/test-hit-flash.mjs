// Static function contract with fake materials/timers, not a game runtime test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/js/client.js', import.meta.url), 'utf8');
const flash = source.slice(source.indexOf('function flashEntityById('), source.indexOf('function spendGolden('));
class Color {
  constructor(value) { this.value = value; }
  clone() { return new Color(this.value); }
  setHex(value) { this.value = value; }
  copy(color) { this.value = color.value; }
}
const material = { emissive: new Color(0.123456789), emissiveIntensity: 0.17 };
const other = { emissive: new Color(0.987654321), emissiveIntensity: 0 };
const timers = [];
const mesh = { userData: {}, traverse(fn) {
  fn({ isMesh: true, material: [material, other] });
  fn({ isMesh: true, material }); // shared slot within one character
  fn({ isMesh: true, material: {} });
} };
const context = vm.createContext({ remoteMeshes: new Map([['target', mesh]]), setTimeout(fn, ms) {
  timers.push({ fn, ms }); return timers.length;
} });
vm.runInContext(flash, context);
const hit = id => vm.runInContext(`flashEntityById(${JSON.stringify(id)})`, context);
hit('missing');
assert.equal(timers.length, 0);
hit('target');
assert.equal(material.emissiveIntensity, 0.35);
assert.equal(timers[0].ms, 90);
hit('target');
assert.equal(timers.length, 1, 'Repeated hits do not extend the flash');
timers[0].fn();
assert.equal(material.emissive.value, 0.123456789, 'Restore exact color, without hex quantization');
assert.equal(material.emissiveIntensity, 0.17);
assert.equal(other.emissive.value, 0.987654321);
assert.equal(other.emissiveIntensity, 0);
material.emissiveIntensity = 0.23;
hit('target');
timers[1].fn();
assert.equal(material.emissiveIntensity, 0.23, 'Snapshot each new flash, not a stale original');
console.log('PASS: bounded flash, repeated hits, material arrays, exact restoration (static only)');
