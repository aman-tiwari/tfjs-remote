import {DataType, Tensor, tensor} from '@tensorflow/tfjs-core'
import {v4 as uuid} from 'uuid';

export const REMOTE_SYMBOL = Symbol.for('@@tensorflowjs/remoteVariable');

export enum Messages {
  Upload = 'upload',
  Download = 'download',
  Update = 'update',
  Op = 'op',
  MethodCall = 'method',
  ServerError = 'error'
}

export type RemoteVar<T> = {
  type: 'remote',
  id: string,
  [REMOTE_SYMBOL]: true,
  meta: object,
  value: T
};

export type SerializedTensor = {
  dtype: DataType,
  shape: number[],
  data: ArrayBuffer
};

export function Var<T>(value?: T, meta?: object): RemoteVar<T> {
  return {type: 'remote', id: uuid(), [REMOTE_SYMBOL]: true, meta, value};
}

export async function serializeTensor(tensor: Tensor):
    Promise<SerializedTensor> {
  const data = await tensor.data();
  // small TypedArrays are views into a larger buffer
  const copy =
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  return {dtype: tensor.dtype, shape: tensor.shape.slice(), data: copy};
};


export function deserializeTensor(serialized: SerializedTensor): Tensor {
  const {dtype, shape, data: dataBuffer} = serialized;
  let data;
  // Because socket.io will deserialise JS ArrayBuffers into Nodejs Buffers
  if (dataBuffer instanceof ArrayBuffer) {
    data = dataBuffer;
    // tslint:disable-next-line no-any
  } else if ((dataBuffer as any) instanceof Buffer) {
    // tslint:disable-next-line no-any
    const dataAsBuffer = dataBuffer as any as Buffer;
    data = dataAsBuffer.buffer.slice(
        dataAsBuffer.byteOffset,
        dataAsBuffer.byteOffset + dataAsBuffer.byteLength);
  }
  const numel = shape.reduce((x, y) => x * y, 1);
  const ctor = dtypeToTypedArrayCtor[dtype];
  const array = new ctor(data, 0, numel);
  return tensor(array, shape, dtype);
};

export const dtypeToTypedArrayCtor = {
  'float32': Float32Array,
  'int32': Int32Array,
  'bool': Uint8Array
};
