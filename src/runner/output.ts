import type {NumberTypedArray} from '@litertjs/core';

import type {OutputData} from './measure';

/** Output tensor data narrowed to number elements; int64/uint64 outputs are not numeric here. */
export function numberOutput(data: OutputData, name: string, who: string): NumberTypedArray {
  const values = data[name];
  if (!values) throw new Error(`${who}: no output data for "${name}"`);
  if (values instanceof BigInt64Array || values instanceof BigUint64Array) {
    throw new Error(`${who}: output "${name}" is a 64-bit integer tensor, expected numeric data`);
  }
  return values;
}
